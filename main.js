import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

// Use with THREE.LoadingManager
const loadingManager = new THREE.LoadingManager(() => {
    // Hide screen when all assets are done
    document.getElementById("loadingScreen").style.display = "none";
});

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

// --------------------- Keyboard ---------------------
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

// --------------------- Camera Mode ---------------------
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

// --------------------- Lights ---------------------
//I removed all lights

// --------------------- GLTF Loader ---------------------
// --------------------- GLTF Loader ---------------------
// ✅ Pass loadingManager into both loaders
const dracoLoader = new DRACOLoader(loadingManager);
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

const loader = new GLTFLoader(loadingManager);
loader.setDRACOLoader(dracoLoader);

loader.load('/model.glb', (gltf) => {
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
}, undefined, (err) => console.error('Model error:', err));


// --------------------- HDRI ---------------------
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();
new EXRLoader().setPath('/').load('sky.exr', (texture) => {
    const envMap = pmremGenerator.fromEquirectangular(texture).texture;
    scene.environment = envMap;
    scene.background = envMap;
    texture.dispose();
    pmremGenerator.dispose();
});

// --------------------- Resize ---------------------
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --------------------- Animate ---------------------
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (activeControls === fpsControls) {
        velocity.set(0, 0, 0); direction.set(0, 0, 0);
        if (move.forward) direction.z -= 1;
        if (move.backward) direction.z += 1;
        if (move.left) direction.x -= 1;
        if (move.right) direction.x += 1;
        direction.normalize();

        const currentSpeed = (isRunning ? runSpeed : baseSpeed) * bunnyHopMultiplier;
        const moveX = direction.x * currentSpeed * delta;
        const moveZ = direction.z * currentSpeed * delta;

        // Proposed position
        const newPos = camera.position.clone();
        newPos.x += moveX;
        newPos.z += -moveZ;

        // Collision
        if (!checkCollisionBox(newPos)) {
            fpsControls.moveRight(moveX);
            fpsControls.moveForward(-moveZ);
        }

        // Gravity / Jump
        verticalVelocity += gravity * delta;
        camera.position.y += verticalVelocity * delta;
        let currentGround = isCrouching ? groundHeight + crouchOffset : groundHeight;
        if (camera.position.y <= currentGround) {
            camera.position.y = currentGround;
            verticalVelocity = 0;
            canJump = true;
            if (!move.forward && !move.backward && !move.left && !move.right) bunnyHopMultiplier = 1;
        }
    } else orbitControls.update();

    renderer.render(scene, camera);
}
animate();
