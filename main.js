import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

// ✅ SMART LOADING MANAGER - calls HTML loading system when done
const loadingManager = new THREE.LoadingManager(() => {
    console.log('All 3D assets loaded!');
    // Notify HTML loading system that assets are ready
    if (window.onAssetsLoaded) {
        window.onAssetsLoaded();
    }
});

// Track loading progress for better feedback
loadingManager.onProgress = function (url, itemsLoaded, itemsTotal) {
    console.log(`Loading: ${itemsLoaded}/${itemsTotal} - ${url}`);
};

loadingManager.onError = function (url) {
    console.error('Error loading:', url);
};

// --------------------- Scene & Camera ---------------------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(250, 20, 0);
camera.lookAt(0, 0, 0);

// --------------------- Renderer ---------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --------------------- Controls ---------------------
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.target.set(0, 1, 0);
orbitControls.update();

const fpsControls = new PointerLockControls(camera, renderer.domElement);
fpsControls.enabled = false;

// --------------------- Movement ---------------------
const move = { forward: false, backward: false, left: false, right: false };
let baseSpeed = 4, runSpeed = 8, isRunning = false;
let velocity = new THREE.Vector3(), direction = new THREE.Vector3();

// Jump / Gravity
let canJump = true, verticalVelocity = 0, gravity = -20, jumpStrength = 5;

// Bunny hop
let bunnyHopMultiplier = 1, maxBunnyHop = 5;

// Crouch
let isCrouching = false, crouchOffset = -0.7, crouchSpeed = 1, normalSpeed = baseSpeed;
let groundHeight = -19;

// --------------------- Collision ---------------------
const collidableObjects = [];
const colliderBoxes = [];
const cameraBox = new THREE.Box3();
const cameraBoxSize = new THREE.Vector3(1, 2, 1); // width, height, depth

function checkCollisionBox(position) {
    cameraBox.setFromCenterAndSize(
        new THREE.Vector3(position.x, position.y + cameraBoxSize.y / 2, position.z),
        cameraBoxSize
    );
    for (let i = 0; i < colliderBoxes.length; i++) {
        if (cameraBox.intersectsBox(colliderBoxes[i])) return true;
    }
    return false;
}

// --------------------- Keyboard Events ---------------------
document.addEventListener('keydown', (e) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight'].includes(e.code)) e.preventDefault();
    switch (e.code) {
        case 'KeyW': move.forward = true; break;
        case 'KeyS': move.backward = true; break;
        case 'KeyA': move.left = true; break;
        case 'KeyD': move.right = true; break;
        case 'ShiftLeft':
        case 'ShiftRight': isRunning = true; break;
        case 'Space':
            if (canJump && !isCrouching) {
                verticalVelocity = jumpStrength; canJump = false;
                if (isRunning) bunnyHopMultiplier = Math.min(bunnyHopMultiplier * 1.1, maxBunnyHop);
            }
            break;
        case 'ControlLeft':
        case 'ControlRight':
            if (!isCrouching) { isCrouching = true; camera.position.y += crouchOffset; normalSpeed = baseSpeed; baseSpeed = crouchSpeed; }
            break;
    }
});

document.addEventListener('keyup', (e) => {
    switch (e.code) {
        case 'KeyW': move.forward = false; break;
        case 'KeyS': move.backward = false; break;
        case 'KeyA': move.left = false; break;
        case 'KeyD': move.right = false; break;
        case 'ShiftLeft':
        case 'ShiftRight': isRunning = false; break;
        case 'ControlLeft':
        case 'ControlRight':
            if (isCrouching) { isCrouching = false; camera.position.y -= crouchOffset; baseSpeed = normalSpeed; }
            break;
    }
});

// --------------------- Pointer Lock ---------------------
document.addEventListener('click', () => { if (activeControls === fpsControls) fpsControls.lock(); });

// --------------------- Camera Mode Switching ---------------------
let activeControls = orbitControls;

function activateOrbitControls() {
    fpsControls.unlock && fpsControls.unlock();
    fpsControls.enabled = false;
    orbitControls.enabled = true;
    activeControls = orbitControls;
    console.log('Orbit Controls Activated');
    document.getElementById("cameraView").value = "orbit";
}

function activateFPSControls() {
    orbitControls.enabled = false;
    fpsControls.enabled = true;
    activeControls = fpsControls;
    camera.position.set(150, -19, 0);
    console.log('FPS Controls Activated');
    document.getElementById("cameraView").value = "fps";
}

window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyO') activateOrbitControls();
    if (e.code === 'KeyP') activateFPSControls();
});

document.getElementById("cameraView").addEventListener("change", (e) => {
    if (e.target.value === "orbit") activateOrbitControls();
    if (e.target.value === "fps") activateFPSControls();
});

// --------------------- GLTF Loader with Loading Manager ---------------------
const dracoLoader = new DRACOLoader(loadingManager);
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

const loader = new GLTFLoader(loadingManager);
loader.setDRACOLoader(dracoLoader);

loader.load('/model.glb',
    (gltf) => {
        console.log('GLTF model loaded successfully');
        scene.add(gltf.scene);

        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new THREE.Vector3());
        gltf.scene.position.sub(center);
        orbitControls.target.copy(center);
        orbitControls.update();

        gltf.scene.traverse((child) => {
            if (child.name && child.name.includes("COLLIDER")) {
                collidableObjects.push(child);
                child.visible = false;
                const bBox = new THREE.Box3().setFromObject(child);
                colliderBoxes.push(bBox);
            }
        });
    },
    (progress) => {
        // Loading progress callback
        const percentComplete = (progress.loaded / progress.total) * 100;
        console.log(`GLTF Loading: ${Math.round(percentComplete)}%`);
    },
    (error) => {
        console.error('GLTF loading error:', error);
    }
);

// --------------------- HDRI Environment ---------------------
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

new EXRLoader(loadingManager).setPath('/').load('sky.exr',
    (texture) => {
        console.log('HDRI loaded successfully');
        const envMap = pmremGenerator.fromEquirectangular(texture).texture;
        scene.environment = envMap;
        scene.background = envMap;
        texture.dispose();
        pmremGenerator.dispose();
    },
    (progress) => {
        const percentComplete = (progress.loaded / progress.total) * 100;
        console.log(`HDRI Loading: ${Math.round(percentComplete)}%`);
    },
    (error) => {
        console.error('HDRI loading error:', error);
    }
);

// --------------------- Window Resize ---------------------
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --------------------- Animation Loop ---------------------
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (activeControls === fpsControls) {
        velocity.set(0, 0, 0);
        direction.set(0, 0, 0);

        if (move.forward) direction.z -= 1;
        if (move.backward) direction.z += 1;
        if (move.left) direction.x -= 1;
        if (move.right) direction.x += 1;
        direction.normalize();

        const currentSpeed = (isRunning ? runSpeed : baseSpeed) * bunnyHopMultiplier;
        const moveX = direction.x * currentSpeed * delta;
        const moveZ = direction.z * currentSpeed * delta;

        // Proposed position for collision checking
        const newPos = camera.position.clone();
        newPos.x += moveX;
        newPos.z += -moveZ;

        // Apply movement if no collision
        if (!checkCollisionBox(newPos)) {
            fpsControls.moveRight(moveX);
            fpsControls.moveForward(-moveZ);
        }

        // Gravity and jumping mechanics
        verticalVelocity += gravity * delta;
        camera.position.y += verticalVelocity * delta;

        let currentGround = isCrouching ? groundHeight + crouchOffset : groundHeight;
        if (camera.position.y <= currentGround) {
            camera.position.y = currentGround;
            verticalVelocity = 0;
            canJump = true;
            if (!move.forward && !move.backward && !move.left && !move.right) {
                bunnyHopMultiplier = 1;
            }
        }
    } else {
        orbitControls.update();
    }

    renderer.render(scene, camera);
}

// Start animation loop
animate();