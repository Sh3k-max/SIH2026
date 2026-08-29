import * as THREE from 'three';

// 1. Procedural Texture Generators
export function createGroundOrthophotoTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // Base ground color (earthy gray asphalt & soil mix)
  ctx.fillStyle = '#475569';
  ctx.fillRect(0, 0, 1024, 1024);

  // Dirt & grass patches
  ctx.fillStyle = '#3f4c38';
  ctx.beginPath();
  ctx.ellipse(850, 700, 200, 300, 0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#4a593e';
  ctx.beginPath();
  ctx.ellipse(150, 200, 180, 250, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Asphalt parking lots
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(50, 450, 380, 520);
  ctx.fillRect(550, 150, 420, 350);

  // Parking lines
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 3;
  for (let y = 500; y < 920; y += 45) {
    ctx.strokeRect(70, y, 70, 35);
    ctx.strokeRect(170, y, 70, 35);
    ctx.strokeRect(280, y, 70, 35);
  }
  for (let y = 180; y < 460; y += 45) {
    ctx.strokeRect(580, y, 70, 35);
    ctx.strokeRect(680, y, 70, 35);
  }

  // Curved Main Roadway
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(420, 0);
  ctx.bezierCurveTo(460, 400, 520, 700, 550, 1024);
  ctx.lineTo(670, 1024);
  ctx.bezierCurveTo(630, 700, 570, 400, 540, 0);
  ctx.closePath();
  ctx.fill();

  // Road Yellow Center Lines
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 5;
  ctx.setLineDash([25, 20]);
  ctx.beginPath();
  ctx.moveTo(480, 0);
  ctx.bezierCurveTo(515, 400, 575, 700, 610, 1024);
  ctx.stroke();
  ctx.setLineDash([]);

  // Road White Curbs
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(425, 0);
  ctx.bezierCurveTo(465, 400, 525, 700, 555, 1024);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(535, 0);
  ctx.bezierCurveTo(565, 400, 625, 700, 665, 1024);
  ctx.stroke();

  // Gravel & concrete detail noise
  for (let i = 0; i < 8000; i++) {
    const rx = Math.random() * 1024;
    const ry = Math.random() * 1024;
    const gray = Math.floor(60 + Math.random() * 80);
    ctx.fillStyle = `rgba(${gray}, ${gray}, ${gray}, 0.15)`;
    ctx.fillRect(rx, ry, 2, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

export function createBuildingFacadeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Building wall base (modern off-white / light gray architectural panel)
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 0, 512, 512);

  // Dark accent banding (lower floors & accent vertical strips)
  ctx.fillStyle = '#64748b';
  ctx.fillRect(0, 420, 512, 92);
  ctx.fillRect(120, 0, 50, 512);
  ctx.fillRect(340, 0, 50, 512);

  // Windows grid
  const floors = 6;
  const columns = 8;
  const floorHeight = 512 / floors;
  const colWidth = 512 / columns;

  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < columns; c++) {
      const wx = c * colWidth + 14;
      const wy = f * floorHeight + 14;
      const ww = colWidth - 28;
      const wh = floorHeight - 28;

      // Window frame
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);

      // Glass gradient
      const grad = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(0.5, '#1e3a8a');
      grad.addColorStop(1, '#38bdf8');
      ctx.fillStyle = grad;
      ctx.fillRect(wx, wy, ww, wh);

      // Window mullion reflection
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(wx + ww / 2, wy);
      ctx.lineTo(wx + ww / 2, wy + wh);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createRooftopTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Dark gravel / asphalt membrane roof
  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 0, 512, 512);

  // Roof membrane seams
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2;
  for (let x = 0; x < 512; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }
  for (let y = 0; y < 512; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createWarehouseTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // White industrial metal siding
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, 512, 512);

  // Corrugation vertical stripes
  ctx.fillStyle = '#cbd5e1';
  for (let x = 0; x < 512; x += 12) {
    ctx.fillRect(x, 0, 4, 512);
  }

  // Industrial loading bay doors
  ctx.fillStyle = '#475569';
  ctx.fillRect(60, 320, 100, 192);
  ctx.fillRect(200, 320, 100, 192);
  ctx.fillRect(340, 320, 100, 192);

  ctx.fillStyle = '#94a3b8';
  for (let y = 330; y < 512; y += 18) {
    ctx.fillRect(65, y, 90, 8);
    ctx.fillRect(205, y, 90, 8);
    ctx.fillRect(345, y, 90, 8);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// 2. Build Photorealistic 3D Commercial Building Complex
export function buildPhotogrammetryScene(scene: THREE.Scene, type: 'building' | 'bridge' | 'solar' | 'terrain' = 'building') {
  // Clear any existing mesh objects
  const toRemove: THREE.Object3D[] = [];
  scene.children.forEach(c => {
    if (c instanceof THREE.Mesh || c instanceof THREE.Group || c instanceof THREE.Points) {
      toRemove.push(c);
    }
  });
  toRemove.forEach(c => scene.remove(c));

  // Shared Textures & Materials
  const groundTex = createGroundOrthophotoTexture();
  const facadeTex = createBuildingFacadeTexture();
  const roofTex = createRooftopTexture();
  const warehouseTex = createWarehouseTexture();

  const groundMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    roughness: 0.85,
    metalness: 0.1
  });

  const facadeMat = new THREE.MeshStandardMaterial({
    map: facadeTex,
    roughness: 0.5,
    metalness: 0.2
  });

  const roofMat = new THREE.MeshStandardMaterial({
    map: roofTex,
    roughness: 0.9,
    metalness: 0.1
  });

  const warehouseMat = new THREE.MeshStandardMaterial({
    map: warehouseTex,
    roughness: 0.4,
    metalness: 0.3
  });

  // Base Ground Plane (400m x 400m survey area)
  const groundGeo = new THREE.PlaneGeometry(420, 420, 32, 32);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  if (type === 'building' || type === 'terrain') {
    const complexGroup = new THREE.Group();

    // 1. Main U-Shaped Multi-Story Commercial Complex
    // West Wing (Main long building)
    const westGeo = new THREE.BoxGeometry(45, 42, 140);
    const westBuilding = new THREE.Mesh(westGeo, [
      facadeMat, facadeMat, roofMat, groundMat, facadeMat, facadeMat
    ]);
    westBuilding.position.set(-80, 21, 20);
    westBuilding.castShadow = true;
    westBuilding.receiveShadow = true;
    complexGroup.add(westBuilding);

    // North Connecting Wing
    const northGeo = new THREE.BoxGeometry(90, 42, 40);
    const northBuilding = new THREE.Mesh(northGeo, [
      facadeMat, facadeMat, roofMat, groundMat, facadeMat, facadeMat
    ]);
    northBuilding.position.set(-25, 21, -30);
    northBuilding.castShadow = true;
    northBuilding.receiveShadow = true;
    complexGroup.add(northBuilding);

    // East Wing (Angled extension)
    const eastGeo = new THREE.BoxGeometry(40, 38, 90);
    const eastBuilding = new THREE.Mesh(eastGeo, [
      facadeMat, facadeMat, roofMat, groundMat, facadeMat, facadeMat
    ]);
    eastBuilding.position.set(10, 19, 25);
    eastBuilding.rotation.y = 0.15;
    eastBuilding.castShadow = true;
    eastBuilding.receiveShadow = true;
    complexGroup.add(eastBuilding);

    // Rooftop HVAC Units and Elevator Shafts
    const hvacMat = new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.6, metalness: 0.4 });
    const hvac1 = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 16), hvacMat);
    hvac1.position.set(-80, 45, 20);
    hvac1.castShadow = true;
    complexGroup.add(hvac1);

    const hvac2 = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 12), hvacMat);
    hvac2.position.set(-80, 44.5, -30);
    hvac2.castShadow = true;
    complexGroup.add(hvac2);

    const hvac3 = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 10), hvacMat);
    hvac3.position.set(10, 40.5, 25);
    hvac3.castShadow = true;
    complexGroup.add(hvac3);

    // 2. Commercial Warehouse Section (Right side across the street)
    const warehouseGeo = new THREE.BoxGeometry(70, 22, 90);
    const warehouseBuilding = new THREE.Mesh(warehouseGeo, [
      warehouseMat, warehouseMat, roofMat, groundMat, warehouseMat, warehouseMat
    ]);
    warehouseBuilding.position.set(125, 11, 20);
    warehouseBuilding.castShadow = true;
    warehouseBuilding.receiveShadow = true;
    complexGroup.add(warehouseBuilding);

    // Small Annex Storage Facility
    const annexGeo = new THREE.BoxGeometry(35, 16, 45);
    const annexBuilding = new THREE.Mesh(annexGeo, [
      warehouseMat, warehouseMat, roofMat, groundMat, warehouseMat, warehouseMat
    ]);
    annexBuilding.position.set(125, 8, -60);
    annexBuilding.castShadow = true;
    annexBuilding.receiveShadow = true;
    complexGroup.add(annexBuilding);

    // 3. 3D Vehicles in Parking Lots
    const carMatColors = ['#ef4444', '#3b82f6', '#f8fafc', '#1e293b', '#64748b', '#eab308'];
    const carPositions = [
      { x: -140, z: 20, rot: 0 },
      { x: -140, z: 40, rot: 0 },
      { x: -140, z: 60, rot: 0 },
      { x: -140, z: 80, rot: 0 },
      { x: 125, z: 80, rot: Math.PI / 2 },
      { x: 145, z: 80, rot: Math.PI / 2 },
      { x: 68, z: -10, rot: -0.2 } // Driving on road
    ];

    carPositions.forEach((pos, idx) => {
      const carGroup = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({
        color: carMatColors[idx % carMatColors.length],
        roughness: 0.3,
        metalness: 0.7
      });

      const body = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.2, 9), bodyMat);
      body.position.y = 1.6;
      body.castShadow = true;
      carGroup.add(body);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(4, 1.8, 4.5), new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.1 }));
      cabin.position.set(0, 3.2, -0.5);
      cabin.castShadow = true;
      carGroup.add(cabin);

      carGroup.position.set(pos.x, 0, pos.z);
      carGroup.rotation.y = pos.rot;
      complexGroup.add(carGroup);
    });

    // 4. Volumetric Trees & Foliage
    const treePositions = [
      { x: 80, z: 70, scale: 1.2 },
      { x: 95, z: 85, scale: 1.4 },
      { x: 110, z: 100, scale: 1.1 },
      { x: 75, z: -40, scale: 1.3 },
      { x: 85, z: -60, scale: 1.5 },
      { x: -30, z: -80, scale: 1.2 },
      { x: -70, z: -90, scale: 1.4 }
    ];

    const trunkMat = new THREE.MeshStandardMaterial({ color: '#543d2b', roughness: 0.9 });
    const leafColors = ['#d97706', '#b45309', '#65a30d', '#4d7c0f'];

    treePositions.forEach((tPos, idx) => {
      const treeGroup = new THREE.Group();
      
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 10), trunkMat);
      trunk.position.y = 5;
      trunk.castShadow = true;
      treeGroup.add(trunk);

      const foliageMat = new THREE.MeshStandardMaterial({
        color: leafColors[idx % leafColors.length],
        roughness: 0.8
      });

      const foliage = new THREE.Mesh(new THREE.DodecahedronGeometry(6.5 * tPos.scale), foliageMat);
      foliage.position.y = 13 * tPos.scale;
      foliage.castShadow = true;
      treeGroup.add(foliage);

      treeGroup.position.set(tPos.x, 0, tPos.z);
      complexGroup.add(treeGroup);
    });

    scene.add(complexGroup);
  }

  // Camera Flight Pyramids (Simulating Drone Camera Stations)
  const camGroup = new THREE.Group();
  const pyrMat = new THREE.MeshBasicMaterial({ color: '#38bdf8', wireframe: true });
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 8; c++) {
      const cx = -140 + c * 40;
      const cz = -100 + r * 50;
      const cy = 85;

      const pyr = new THREE.Mesh(new THREE.ConeGeometry(3.5, 5, 4), pyrMat);
      pyr.position.set(cx, cy, cz);
      pyr.rotation.x = Math.PI; // Point down towards ground
      camGroup.add(pyr);
    }
  }
  scene.add(camGroup);
}

// 3. High-Density Photogrammetric Point Cloud (50,000+ points)
export function generateDensePointCloud(type: 'building' | 'bridge' | 'solar' | 'terrain' = 'building'): THREE.Points {
  const pointCount = 45000;
  const positions = new Float32Array(pointCount * 3);
  const colors = new Float32Array(pointCount * 3);

  let pIdx = 0;

  const addPoint = (x: number, y: number, z: number, r: number, g: number, b: number) => {
    if (pIdx >= pointCount) return;
    positions[pIdx * 3] = x;
    positions[pIdx * 3 + 1] = y;
    positions[pIdx * 3 + 2] = z;
    colors[pIdx * 3] = r;
    colors[pIdx * 3 + 1] = g;
    colors[pIdx * 3 + 2] = b;
    pIdx++;
  };

  // 1. Ground Surface (Asphalt roads, grass, parking)
  for (let i = 0; i < 20000; i++) {
    const gx = (Math.random() - 0.5) * 380;
    const gz = (Math.random() - 0.5) * 380;
    const gy = (Math.random() - 0.5) * 0.8;

    // Roadway strip
    if (Math.abs(gx - 50) < 30) {
      addPoint(gx, gy, gz, 0.2, 0.25, 0.3); // Dark asphalt
    } else if (gx > 80 && gz > 60) {
      addPoint(gx, gy, gz, 0.7, 0.45, 0.1); // Autumn foliage ground
    } else if (gx < -60 && gz > 20) {
      addPoint(gx, gy, gz, 0.15, 0.2, 0.25); // Parking lot
    } else {
      addPoint(gx, gy, gz, 0.35, 0.4, 0.45); // Concrete & soil
    }
  }

  // 2. Main Commercial Building Facades & Rooftops
  for (let i = 0; i < 15000; i++) {
    // West Wing
    const bx = -80 + (Math.random() - 0.5) * 45;
    const bz = 20 + (Math.random() - 0.5) * 140;
    const by = Math.random() * 42;

    if (Math.random() > 0.4) {
      // Facade / Window dots
      const isWindow = Math.random() > 0.6;
      if (isWindow) {
        addPoint(bx, by, bz, 0.1, 0.3, 0.6); // Blue glass reflection
      } else {
        addPoint(bx, by, bz, 0.85, 0.88, 0.92); // White facade
      }
    } else {
      // Roof points
      addPoint(bx, 42 + Math.random() * 0.5, bz, 0.25, 0.28, 0.32);
    }
  }

  // 3. Warehouse Structure
  for (let i = 0; i < 6000; i++) {
    const wx = 125 + (Math.random() - 0.5) * 70;
    const wz = 20 + (Math.random() - 0.5) * 90;
    const wy = Math.random() * 22;
    addPoint(wx, wy, wz, 0.9, 0.92, 0.95);
  }

  // 4. Foliage / Trees Clusters
  for (let i = 0; i < 4000; i++) {
    const tx = 85 + (Math.random() - 0.5) * 40;
    const tz = 80 + (Math.random() - 0.5) * 50;
    const ty = 3 + Math.random() * 16;
    addPoint(tx, ty, tz, 0.85 + Math.random() * 0.1, 0.5 + Math.random() * 0.2, 0.05); // Autumn gold leaves
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 1.8,
    vertexColors: true,
    sizeAttenuation: true
  });

  return new THREE.Points(geometry, material);
}

// 4. Load Real COLMAP Reconstruction from south-building dataset
export async function loadSouthBuildingPointCloud(serverUrl: string = 'http://localhost:5000'): Promise<{ points: THREE.Points; count: number; cameras: Array<{ name: string; x: number; y: number; z: number }> } | null> {
  try {
    const res = await fetch(`${serverUrl}/api/datasets/south-building/sparse`);
    if (!res.ok) throw new Error('Dataset endpoint returned ' + res.status);
    const data = await res.json();
    if (!data.positions || data.positions.length === 0) return null;

    const rawPos = data.positions;
    const rawCol = data.colors;
    const pCount = data.pointCount;

    // Calculate center of mass to align model at origin
    let sumX = 0, sumY = 0, sumZ = 0;
    for (let i = 0; i < pCount; i++) {
      sumX += rawPos[i * 3];
      sumY += rawPos[i * 3 + 1];
      sumZ += rawPos[i * 3 + 2];
    }
    const avgX = sumX / pCount;
    const avgY = sumY / pCount;
    const avgZ = sumZ / pCount;

    // Scaling factor to scale COLMAP unit coordinates to comfortable Three.js units (~180m span)
    const scale = 40.0;

    const positions = new Float32Array(pCount * 3);
    const colors = new Float32Array(rawCol);

    for (let i = 0; i < pCount; i++) {
      // Shift center and orient right-side up
      positions[i * 3] = (rawPos[i * 3] - avgX) * scale;
      positions[i * 3 + 1] = -(rawPos[i * 3 + 1] - avgY) * scale; // Invert Y (COLMAP camera Y is down)
      positions[i * 3 + 2] = (rawPos[i * 3 + 2] - avgZ) * scale;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 1.5,
      vertexColors: true,
      sizeAttenuation: true
    });

    const scaledCameras = (data.cameras || []).map((c: { name: string; x: number; y: number; z: number }) => ({
      name: c.name,
      x: (c.x - avgX) * scale,
      y: -(c.y - avgY) * scale,
      z: (c.z - avgZ) * scale
    }));

    return {
      points: new THREE.Points(geometry, material),
      count: pCount,
      cameras: scaledCameras
    };
  } catch (e) {
    console.error('Failed to load south-building dataset:', e);
    return null;
  }
}
