/**
 * 360° Drone Video 3D Reconstruction Engine - Web Client
 * High-Fidelity 3D Gaussian Splatting + Multi-View Geometry Studio
 */

let scene, camera, renderer, controls;
let modelRoot = null;
let currentSplats = null;
let currentPoints = null;
let currentMesh = null;
let selectedFile = null;

// UI Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const videoSelectedInfo = document.getElementById('video-selected-info');
const videoFilenameTxt = document.getElementById('video-filename-txt');
const btnUseSampleVideo = document.getElementById('btn-use-sample-video');
const btnStart = document.getElementById('btn-start');

const statusBox = document.getElementById('status-box');
const statusTitle = document.getElementById('status-title');
const statusPct = document.getElementById('status-pct');
const progressFill = document.getElementById('progress-fill');
const statusLog = document.getElementById('status-log');

const resultsBox = document.getElementById('results-box');
const telemetryInfo = document.getElementById('telemetry-info');
const dlSplat = document.getElementById('dl-splat');
const dlPly = document.getElementById('dl-ply');
const dlObj = document.getElementById('dl-obj');
const dlScene = document.getElementById('dl-scene');

const btnViewSplats = document.getElementById('btn-view-splats');
const btnViewPts = document.getElementById('btn-view-pts');
const btnViewSolid = document.getElementById('btn-view-solid');
const btnViewWire = document.getElementById('btn-view-wire');
const btnResetView = document.getElementById('btn-reset-view');


// Initialize Three.js Viewport
function init3D() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth || 960;
    const height = container.clientHeight || 480;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060810);
    scene.fog = new THREE.FogExp2(0x060810, 0.003);

    camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 1000);
    camera.position.set(16, 12, 20);

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
        precision: 'highp'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxDistance = 200;
    controls.minDistance = 1.0;
    controls.target.set(0, 2.5, 0);

    // Natural Sunlight & Ambient Lighting
    const ambientSky = new THREE.HemisphereLight(0xffffff, 0x1e293b, 1.4);
    scene.add(ambientSky);

    const sunLight = new THREE.DirectionalLight(0xfffbeb, 2.5);
    sunLight.position.set(40, 60, 35);
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0x7dd3fc, 0.8);
    fillLight.position.set(-35, 25, -30);
    scene.add(fillLight);

    // Model group
    modelRoot = new THREE.Group();
    scene.add(modelRoot);

    // Subtle Ground Calibration Grid (+Y Up, Ground at Y=0)
    const grid = new THREE.GridHelper(40, 40, 0x00f0ff, 0x182236);
    grid.position.y = -0.02;
    scene.add(grid);

    window.addEventListener('resize', onWindowResize);
    animate();
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    if (!container || !renderer || !camera) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
}

function resetCamera() {
    if (modelRoot && modelRoot.children.length > 0) {
        const box = new THREE.Box3().setFromObject(modelRoot);
        if (!box.isEmpty()) {
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            controls.target.copy(center);
            camera.position.set(center.x + maxDim * 1.25, center.y + maxDim * 0.85, center.z + maxDim * 1.25);
            controls.update();
            return;
        }
    }
    camera.position.set(16, 12, 20);
    controls.target.set(0, 2.5, 0);
    controls.update();
}

// Drag & Drop Handling
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '#00ffcc';
});

dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--accent-cyan)';
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--accent-cyan)';
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        setChosenFile(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
        setChosenFile(e.target.files[0]);
    }
});

function setChosenFile(file) {
    selectedFile = file;
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    videoFilenameTxt.textContent = `${file.name} (${mb} MB)`;
    videoSelectedInfo.style.display = 'block';
    btnStart.disabled = false;
}

// Preset Sample Video Button
btnUseSampleVideo.addEventListener('click', () => {
    selectedFile = null;
    videoFilenameTxt.textContent = 'inp/input.mp4 (Sample 360 Drone Video)';
    videoSelectedInfo.style.display = 'block';
    btnStart.disabled = false;
});

// Launch Reconstruction
btnStart.addEventListener('click', async () => {
    btnStart.disabled = true;
    statusBox.style.display = 'block';
    resultsBox.style.display = 'none';

    statusTitle.textContent = 'PROCESSING...';
    statusPct.textContent = '5%';
    progressFill.style.width = '5%';
    statusLog.textContent = 'Uploading 360 drone video & initializing 3D Gaussian Splatting pipeline...';

    try {
        const formData = new FormData();
        formData.append('keyframes_count', 16);

        if (selectedFile) {
            formData.append('video_file', selectedFile);
        } else {
            formData.append('existing_video_path', 'inp/input.mp4');
        }

        const res = await fetch('/reconstruct', {
            method: 'POST',
            body: formData
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const jobId = data.job_id;
        trackJob(jobId);
    } catch (err) {
        statusTitle.textContent = 'FAILED';
        statusLog.textContent = `Error: ${err.message}`;
        btnStart.disabled = false;
    }
});

function trackJob(jobId) {
    let isFinished = false;

    function handleProgressUpdate(data) {
        if (!data || isFinished) return;
        const pct = Math.round((data.progress || 0) * 100);
        progressFill.style.width = `${pct}%`;
        statusPct.textContent = `${pct}%`;
        statusLog.textContent = data.message || 'Processing 3D reconstruction...';

        if (data.status === 'completed') {
            isFinished = true;
            btnStart.disabled = false;
            statusTitle.textContent = 'COMPLETED';

            resultsBox.style.display = 'block';
            telemetryInfo.textContent = `Reconstructed 3D Gaussian Points: ${Number(data.point_count || 0).toLocaleString()} | Time: ${data.elapsed_seconds}s | Coordinate Frame: +Y Up, Ground at Y=0`;

            const assets = data.assets || {};
            dlSplat.href = assets.gaussian_splat || `/gaussians/${jobId}`;
            dlPly.href = assets.gaussian_ply || `/pointcloud/${jobId}`;
            dlObj.href = assets.mesh_obj || `#`;
            dlScene.href = assets.scene_json || `/scene/${jobId}`;

            // Load 3D Gaussian Splatting Model into Viewport
            loadSceneToPreview(assets.mesh_ply || assets.mesh_obj, assets.dense_ply || assets.gaussian_ply || `/pointcloud/${jobId}`);
        } else if (data.status === 'failed') {
            isFinished = true;
            btnStart.disabled = false;
            statusTitle.textContent = 'FAILED';
            statusLog.textContent = data.message || 'Reconstruction failed.';
        }
    }

    // 1. SSE Stream
    try {
        const evt = new EventSource(`/api/progress/${jobId}`);
        evt.onmessage = (e) => {
            try {
                handleProgressUpdate(JSON.parse(e.data));
            } catch (err) {}
            if (isFinished) evt.close();
        };
        evt.addEventListener('update', (e) => {
            try {
                handleProgressUpdate(JSON.parse(e.data));
            } catch (err) {}
            if (isFinished) evt.close();
        });
        evt.onerror = () => {
            if (isFinished) evt.close();
        };
    } catch (e) {}

    // 2. High-reliability Polling Fallback
    const pollInterval = setInterval(async () => {
        if (isFinished) {
            clearInterval(pollInterval);
            return;
        }
        try {
            const res = await fetch(`/status/${jobId}`);
            if (res.ok) {
                const data = await res.json();
                handleProgressUpdate(data);
                if (data.status === 'completed' || data.status === 'failed') {
                    clearInterval(pollInterval);
                }
            }
        } catch (err) {}
    }, 800);
}

// High-Performance 3D Gaussian Splatting Billboard Shader
function createGaussianSplatMesh(geometry, splatScale = 1.85) {
    const posAttr = geometry.attributes.position;
    const colAttr = geometry.attributes.color;
    if (!posAttr) return null;

    const count = posAttr.count;
    const billboardGeo = new THREE.PlaneGeometry(1, 1);

    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
        uniforms: {
            uScaleMult: { value: splatScale }
        },
        vertexShader: `
            attribute vec3 instanceColor;
            attribute vec3 instanceScale;
            attribute float instanceOpacity;
            varying vec3 vColor;
            varying vec2 vUv;
            varying float vOpacity;
            uniform float uScaleMult;

            void main() {
                vColor = instanceColor;
                vUv = uv;
                vOpacity = instanceOpacity;
                
                vec3 transformed = position * instanceScale * uScaleMult;
                vec4 mvPosition = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
                mvPosition.xyz += transformed;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            varying vec2 vUv;
            varying float vOpacity;

            void main() {
                vec2 centerOffset = vUv - vec2(0.5);
                float r2 = dot(centerOffset, centerOffset);
                if (r2 > 0.25) discard;
                
                // Continuous Gaussian exponential alpha falloff
                float gaussianAlpha = exp(-3.8 * r2) * vOpacity;
                gl_FragColor = vec4(vColor, gaussianAlpha);
            }
        `
    });

    const instancedMesh = new THREE.InstancedMesh(billboardGeo, material, count);
    const matrix = new THREE.Matrix4();
    const colorsAttr = new Float32Array(count * 3);
    const scalesAttr = new Float32Array(count * 3);
    const opacitiesAttr = new Float32Array(count);

    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1.0;
    const baseRadius = Math.max(0.04, Math.min(0.28, maxDim / 120.0));

    for (let i = 0; i < count; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        const z = posAttr.getZ(i);

        matrix.setPosition(x, y, z);
        instancedMesh.setMatrixAt(i, matrix);

        if (colAttr) {
            colorsAttr[i * 3 + 0] = colAttr.getX(i);
            colorsAttr[i * 3 + 1] = colAttr.getY(i);
            colorsAttr[i * 3 + 2] = colAttr.getZ(i);
        } else {
            colorsAttr[i * 3 + 0] = 0.85;
            colorsAttr[i * 3 + 1] = 0.85;
            colorsAttr[i * 3 + 2] = 0.85;
        }

        scalesAttr[i * 3 + 0] = baseRadius;
        scalesAttr[i * 3 + 1] = baseRadius;
        scalesAttr[i * 3 + 2] = baseRadius * 0.8;

        opacitiesAttr[i] = 0.95;
    }

    billboardGeo.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorsAttr, 3));
    billboardGeo.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(scalesAttr, 3));
    billboardGeo.setAttribute('instanceOpacity', new THREE.InstancedBufferAttribute(opacitiesAttr, 1));

    return instancedMesh;
}

function loadSceneToPreview(meshUrl, plyUrl) {
    while (modelRoot.children.length > 0) {
        modelRoot.remove(modelRoot.children[0]);
    }
    currentSplats = null;
    currentPoints = null;
    currentMesh = null;

    // 1. Load Photorealistic 3D Gaussian Splats & Raw Points
    if (plyUrl && THREE.PLYLoader) {
        const plyLoader = new THREE.PLYLoader();
        plyLoader.load(plyUrl, (geometry) => {
            // Build Instanced 3D Gaussian Splatting Billboard Mesh
            currentSplats = createGaussianSplatMesh(geometry, 1.85);
            if (currentSplats) {
                modelRoot.add(currentSplats);
                currentSplats.visible = true; // Default view is photorealistic Gaussian Splats
            }

            // Also build raw Points for fallback/technical point view
            geometry.computeBoundingBox();
            const box = geometry.boundingBox;
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1.0;
            const pointSize = Math.max(0.004, Math.min(0.05, maxDim / 180));

            const hasColors = !!geometry.attributes.color;
            const ptMat = new THREE.PointsMaterial({
                size: pointSize,
                vertexColors: hasColors,
                color: hasColors ? 0xffffff : 0x00f0ff,
                transparent: false,
                opacity: 1.0
            });
            currentPoints = new THREE.Points(geometry, ptMat);
            currentPoints.visible = false;
            modelRoot.add(currentPoints);

            setActiveButton(btnViewSplats);
            resetCamera();
        });
    }

    // 2. Load Solid Continuous Mesh
    if (meshUrl && THREE.PLYLoader && meshUrl.endsWith('.ply')) {
        const plyLoader = new THREE.PLYLoader();
        plyLoader.load(meshUrl, (geometry) => {
            geometry.computeVertexNormals();
            const hasColors = !!geometry.attributes.color;
            const meshMat = new THREE.MeshStandardMaterial({
                vertexColors: hasColors,
                color: hasColors ? 0xffffff : 0xddeeff,
                roughness: 0.5,
                metalness: 0.1,
                side: THREE.DoubleSide
            });
            currentMesh = new THREE.Mesh(geometry, meshMat);
            currentMesh.visible = false;
            modelRoot.add(currentMesh);
        }, undefined, () => {
            if (meshUrl.replace('.ply', '.obj')) loadObjMesh(meshUrl.replace('.ply', '.obj'));
        });
    } else if (meshUrl) {
        loadObjMesh(meshUrl);
    }
}

function loadObjMesh(url) {
    const objLoader = new THREE.OBJLoader();
    objLoader.load(url, (obj) => {
        obj.traverse((child) => {
            if (child.isMesh) {
                currentMesh = child;
                child.material = new THREE.MeshStandardMaterial({
                    vertexColors: child.geometry.attributes.color ? true : false,
                    color: child.geometry.attributes.color ? 0xffffff : 0xcccccc,
                    roughness: 0.6,
                    metalness: 0.1,
                    side: THREE.DoubleSide
                });
            }
        });
        if (currentMesh) {
            currentMesh.visible = false;
            modelRoot.add(currentMesh);
        }
    });
}

function setActiveButton(activeBtn) {
    [btnViewSplats, btnViewPts, btnViewSolid, btnViewWire].forEach(b => {
        if (b) b.classList.remove('active');
    });
    if (activeBtn) activeBtn.classList.add('active');
}

// Viewport Toolbar Buttons
if (btnViewSplats) {
    btnViewSplats.addEventListener('click', () => {
        if (currentSplats) currentSplats.visible = true;
        if (currentPoints) currentPoints.visible = false;
        if (currentMesh) currentMesh.visible = false;
        setActiveButton(btnViewSplats);
    });
}

if (btnViewPts) {
    btnViewPts.addEventListener('click', () => {
        if (currentSplats) currentSplats.visible = false;
        if (currentPoints) currentPoints.visible = true;
        if (currentMesh) currentMesh.visible = false;
        setActiveButton(btnViewPts);
    });
}

if (btnViewSolid) {
    btnViewSolid.addEventListener('click', () => {
        if (currentSplats) currentSplats.visible = false;
        if (currentPoints) currentPoints.visible = false;
        if (currentMesh) {
            currentMesh.visible = true;
            currentMesh.material.wireframe = false;
        }
        setActiveButton(btnViewSolid);
    });
}

if (btnViewWire) {
    btnViewWire.addEventListener('click', () => {
        if (currentSplats) currentSplats.visible = false;
        if (currentPoints) currentPoints.visible = false;
        if (currentMesh) {
            currentMesh.visible = true;
            currentMesh.material.wireframe = true;
        }
        setActiveButton(btnViewWire);
    });
}

if (btnResetView) {
    btnResetView.addEventListener('click', resetCamera);
}

// Start
window.addEventListener('DOMContentLoaded', () => {
    init3D();
});
