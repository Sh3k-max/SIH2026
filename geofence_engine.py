"""
3D Geofencing & GPS Telemetry Engine for Drone 3D Reconstruction & Gaussian Splats
Handles GPS (WGS84) to UTM transformation, 7-parameter Helmert Sim(3) alignment, and 3D boundary clipping.
"""

import math
import numpy as np
from typing import List, Dict, Tuple, Optional, Union


class GeofenceEngine:
    """Provides GPS alignment, Sim(3) transformations, and 3D geofence boundary filtering."""

    @staticmethod
    def latlon_to_utm(lat: float, lon: float) -> Tuple[float, float, int, str]:
        """
        Converts WGS84 (Lat, Lon) in degrees to UTM Cartesian Coordinates (East, North, Zone, Hem).
        Uses standard Karney / WGS84 projection formulas.
        """
        # WGS84 constants
        a = 6378137.0
        f = 1 / 298.257223563
        e2 = 2 * f - f * f

        zone = int((lon + 180) / 6) + 1
        hem = 'N' if lat >= 0 else 'S'
        lon0 = (zone - 1) * 6 - 180 + 3

        lat_rad = math.radians(lat)
        lon_rad = math.radians(lon)
        lon0_rad = math.radians(lon0)

        N = a / math.sqrt(1 - e2 * math.sin(lat_rad) ** 2)
        T = math.tan(lat_rad) ** 2
        C = (e2 / (1 - e2)) * (math.cos(lat_rad) ** 2)
        A = (lon_rad - lon0_rad) * math.cos(lat_rad)

        M = a * ((1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256) * lat_rad
                 - (3 * e2 / 8 + 3 * e2**2 / 32 + 45 * e2**3 / 1024) * math.sin(2 * lat_rad)
                 + (15 * e2**2 / 256 + 45 * e2**3 / 1024) * math.sin(4 * lat_rad)
                 - (35 * e2**3 / 3072) * math.sin(6 * lat_rad))

        k0 = 0.9996
        e_prime2 = e2 / (1 - e2)

        x = k0 * N * (A + (1 - T + C) * A**3 / 6 + (5 - 18 * T + T**2 + 72 * C - 58 * e_prime2) * A**5 / 120) + 500000.0
        y = k0 * (M + N * math.tan(lat_rad) * (A**2 / 2 + (5 - T + 9 * C + 4 * C**2) * A**4 / 24 + (61 - 58 * T + T**2 + 600 * C - 330 * e_prime2) * A**6 / 720))
        if lat < 0:
            y += 10000000.0

        return x, y, zone, hem

    @staticmethod
    def compute_umeyama_sim3(src_points: np.ndarray, dst_points: np.ndarray) -> Tuple[float, np.ndarray, np.ndarray]:
        """
        Computes the 7-parameter similarity transformation (Scale s, Rotation R, Translation t)
        such that dst_points ≈ s * R @ src_points + t using the Umeyama algorithm.
        """
        src = np.asarray(src_points, dtype=np.float64)
        dst = np.asarray(dst_points, dtype=np.float64)
        n, m = src.shape

        if n < 3:
            return 1.0, np.eye(3), np.zeros(3)

        src_mean = src.mean(axis=0)
        dst_mean = dst.mean(axis=0)

        src_centered = src - src_mean
        dst_centered = dst - dst_mean

        src_var = np.sum(src_centered ** 2) / n
        if src_var < 1e-9:
            return 1.0, np.eye(3), dst_mean - src_mean

        # Cross-covariance matrix
        H = (dst_centered.T @ src_centered) / n

        U, S, Vt = np.linalg.svd(H)
        R = U @ Vt

        # Handle reflection
        if np.linalg.det(R) < 0:
            Vt[-1, :] *= -1
            R = U @ Vt

        scale = np.sum(S) / src_var
        t = dst_mean - scale * (R @ src_mean)

        return float(scale), R, t

    @staticmethod
    def apply_sim3(points: np.ndarray, scale: float, R: np.ndarray, t: np.ndarray) -> np.ndarray:
        """Applies 7-parameter transformation to (N, 3) points."""
        return (scale * (points @ R.T)) + t

    @staticmethod
    def is_point_in_2d_polygon(point_xy: Tuple[float, float], polygon: List[Tuple[float, float]]) -> bool:
        """Ray-casting algorithm to test if (x, y) is inside a 2D polygon."""
        x, y = point_xy
        inside = False
        n = len(polygon)
        p1x, p1y = polygon[0]
        for i in range(n + 1):
            p2x, p2y = polygon[i % n]
            if y > min(p1y, p2y):
                if y <= max(p1y, p2y):
                    if x <= max(p1x, p2x):
                        if p1y != p2y:
                            xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                        if p1x == p2x or x <= xinters:
                            inside = not inside
            p1x, p1y = p2x, p2y
        return inside

    @staticmethod
    def filter_points_by_geofence(
        points: np.ndarray,
        geofence_type: str = "cylinder",
        center: Tuple[float, float, float] = (0.0, 0.0, 0.0),
        radius: float = 10.0,
        bounds_box: Optional[Tuple[float, float, float, float, float, float]] = None,
        polygon_2d: Optional[List[Tuple[float, float]]] = None,
        min_alt: Optional[float] = None,
        max_alt: Optional[float] = None,
        mode: str = "keep_inside"
    ) -> np.ndarray:
        """
        Returns a boolean mask of points inside (or outside) the 3D geofence.
        - cylinder: center (x, y, z), radius r, optional [min_alt, max_alt]
        - box: bounds_box [xmin, xmax, ymin, ymax, zmin, zmax]
        - polygon: 2D polygon vertices [(x1, y1), (x2, y2), ...] + altitude bounds
        """
        N = len(points)
        if N == 0:
            return np.array([], dtype=bool)

        pts = np.asarray(points)
        mask = np.ones(N, dtype=bool)

        # 1. Altitude limits
        if min_alt is not None:
            mask &= (pts[:, 1] >= min_alt) if pts.shape[1] > 1 else True
        if max_alt is not None:
            mask &= (pts[:, 1] <= max_alt) if pts.shape[1] > 1 else True

        # 2. Geometry check
        if geofence_type == "cylinder":
            cx, cy, cz = center
            dx = pts[:, 0] - cx
            dz = pts[:, 2] - cz
            dist_sq = dx * dx + dz * dz
            mask &= (dist_sq <= radius * radius)

        elif geofence_type == "box" and bounds_box is not None:
            xmin, xmax, ymin, ymax, zmin, zmax = bounds_box
            mask &= (pts[:, 0] >= xmin) & (pts[:, 0] <= xmax)
            mask &= (pts[:, 1] >= ymin) & (pts[:, 1] <= ymax)
            mask &= (pts[:, 2] >= zmin) & (pts[:, 2] <= zmax)

        elif geofence_type == "polygon" and polygon_2d and len(polygon_2d) >= 3:
            poly_mask = np.array([
                GeofenceEngine.is_point_in_2d_polygon((p[0], p[2]), polygon_2d)
                for p in pts
            ], dtype=bool)
            mask &= poly_mask

        return mask if mode == "keep_inside" else ~mask

    @staticmethod
    def filter_gaussians(
        gaussians: Dict[str, np.ndarray],
        geofence_type: str = "cylinder",
        center: Tuple[float, float, float] = (0.0, 0.0, 0.0),
        radius: float = 10.0,
        bounds_box: Optional[Tuple[float, float, float, float, float, float]] = None,
        polygon_2d: Optional[List[Tuple[float, float]]] = None,
        min_alt: Optional[float] = None,
        max_alt: Optional[float] = None,
        mode: str = "keep_inside"
    ) -> Dict[str, np.ndarray]:
        """Filters a 3D Gaussian dictionary by applying the geofence to the Gaussian centers (positions)."""
        positions = gaussians["positions"]
        mask = GeofenceEngine.filter_points_by_geofence(
            points=positions,
            geofence_type=geofence_type,
            center=center,
            radius=radius,
            bounds_box=bounds_box,
            polygon_2d=polygon_2d,
            min_alt=min_alt,
            max_alt=max_alt,
            mode=mode
        )

        filtered = {}
        for k, v in gaussians.items():
            if isinstance(v, np.ndarray) and len(v) == len(positions):
                filtered[k] = v[mask]
            else:
                filtered[k] = v

        filtered["count"] = int(mask.sum())
        return filtered
