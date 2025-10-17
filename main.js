import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

// This will track which debug meshes are currently visible in the scene
const visibleDebugMeshes = new Map(); // Maps an OBB object to its THREE.Mesh

// Add these variables near the top of main.js
let isTweeningCamera = false;
const tweenTarget = {
    position: new THREE.Vector3(),
    lookAt: new THREE.Vector3()
};
const TWEEN_SPEED = 0.05; // Controls the speed of the camera transition

// Smart LOD System (no new models required)
const SMART_LOD = {
    enabled: true,
    updateInterval: 0.3,
    lastUpdate: 0,

    distances: {
        full: 80,      // Full quality within 80 units
        reduced: 200,  // Reduced quality within 200 units
        minimal: 400,  // Minimal quality within 400 units
        // Beyond 400 = hidden
    },

    // Track which objects are at which LOD level
    meshLODLevels: new Map(),
    originalGeometries: new Map(),
    culledMeshes: new Set()
};

// Define your 5 camera views here
const predefinedViews = [
    { position: new THREE.Vector3(114.54, 45, -5), lookAt: new THREE.Vector3(114.54, 45, 40), name: 'Main Entrance' },
    { position: new THREE.Vector3(189.79, 38.72, -52.36), lookAt: new THREE.Vector3(90.37, 0.36, -52.36), name: 'Acad. Block 1' },
    { position: new THREE.Vector3(77.61, 19.22, -8.10), lookAt: new THREE.Vector3(38.52, 1.85, 20.43), name: 'Main Ground' },
    { position: new THREE.Vector3(-46.67, 82.05, -114.36), lookAt: new THREE.Vector3(14.62, 1.85, -55.86), name: 'Sports Courts' },
    { position: new THREE.Vector3(39.35, 1.85, 20.43), lookAt: new THREE.Vector3(39.19, 9.86, 62.36), name: 'Boys Hostel - 2' },
    { position: new THREE.Vector3(7.16, 16.75, -55.86), lookAt: new THREE.Vector3(-29.10, 19.70, -10.40), name: 'Girls Hostel' },
    { position: new THREE.Vector3(42.59, 31.89, -11.47), lookAt: new THREE.Vector3(75.10, 27.27, 6.39), name: 'Academic Block - 2' },
    { position: new THREE.Vector3(7.44, 19.80, 34.12), lookAt: new THREE.Vector3(-25.32, 15.47, 54.87), name: 'BCA/MCA Building' },
    { position: new THREE.Vector3(136.01, 1.85, 44.73), lookAt: new THREE.Vector3(114.65, 9.87, 55.91), name: 'GLBIMR' },
    { position: new THREE.Vector3(55, 26.5, 65), lookAt: new THREE.Vector3(52.38, 0.50, -8.89), name: 'Boys-Hostel Balcony View' },
    { position: new THREE.Vector3(-31.93, 31, 5.05), lookAt: new THREE.Vector3(0, 0, 0), name: 'Girls-Hostel Balcony View' },
];
let jumpPressed = false;
let yellowCuboids = [];
// Create popup div dynamically and style it
let areaPrompt = document.getElementById('areaPrompt');
if (!areaPrompt) {
    areaPrompt = document.createElement('div');
    areaPrompt.id = 'areaPrompt';

    Object.assign(areaPrompt.style, {
        position: 'fixed',
        bottom: '5vh',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.6)',
        color: 'white',
        padding: '1vh 3vh',
        borderRadius: '0.8vh',
        fontFamily: "'Orbitron', monospace",
        fontWeight: 'bold',
        fontSize: '3vw',
        zIndex: '10000',
        display: 'none',
        pointerEvents: 'none',
        userSelect: 'none',
        transition: 'opacity 0.5s ease',
    });

    areaPrompt.textContent = 'Academic Block - 2';

    document.body.appendChild(areaPrompt);
}


if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    window.DEBUG_COLLIDERS = false;  // Disable debug meshes on mobile
    window.DEBUG_COLLISION_LOG = false; // Disable collision logs
}

// ✅ FIXED OBB (Oriented Bounding Box) Class - Properly transforms AABB to OBB
class OBB {
    constructor(center, extents, rotation) {
        this.center = center ? center.clone() : new THREE.Vector3();
        this.extents = extents ? extents.clone() : new THREE.Vector3(); // Half-sizes along each axis
        this.rotation = rotation ? rotation.clone() : new THREE.Euler();
        this.quaternion = new THREE.Quaternion();
        this.axes = [
            new THREE.Vector3(),
            new THREE.Vector3(),
            new THREE.Vector3()
        ];
        this.updateAxes();
    }

    updateAxes() {
        // Get the three axes of the OBB from the rotation matrix
        const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(this.rotation);
        this.axes[0].set(1, 0, 0).applyMatrix4(rotationMatrix);
        this.axes[1].set(0, 1, 0).applyMatrix4(rotationMatrix);
        this.axes[2].set(0, 0, 1).applyMatrix4(rotationMatrix);

        // Update quaternion
        this.quaternion.setFromEuler(this.rotation);
    }

    /**
     * PROPER 3-STEP OBB CREATION:
     * 1. Build AABB (Box3) from mesh geometry
     * 2. Use that box to get the size & center
     * 3. Transform it into an OBB by applying mesh's world rotation and position
     */
    static fromMesh(mesh) {
        console.log(`Creating OBB for mesh: ${mesh.name || 'unnamed'}`);

        // STEP 1: Build AABB (Box3) from mesh geometry
        if (!mesh.geometry.boundingBox) {
            mesh.geometry.computeBoundingBox();
        }

        // Get the local space AABB from geometry
        const localAABB = new THREE.Box3().copy(mesh.geometry.boundingBox);

        // STEP 2: Use that box to get the size & center
        const aabbSize = new THREE.Vector3();
        const aabbCenter = new THREE.Vector3();

        localAABB.getSize(aabbSize);
        localAABB.getCenter(aabbCenter);

        // STEP 3: Transform it into an OBB by applying mesh's world rotation and position

        // Update world matrix to ensure we have current transforms
        mesh.updateMatrixWorld(true);

        // Extract world transformation components
        const worldPosition = new THREE.Vector3();
        const worldQuaternion = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();

        mesh.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);

        // Transform the AABB center to world space
        const worldCenter = aabbCenter.clone();
        worldCenter.multiply(worldScale); // Apply scale first
        worldCenter.applyQuaternion(worldQuaternion); // Then rotation
        worldCenter.add(worldPosition); // Finally translation

        // Apply world scale to the size and get half-extents
        const worldExtents = aabbSize.clone();
        worldExtents.multiply(worldScale);
        worldExtents.multiplyScalar(0.5); // Convert to half-extents

        // Get world rotation as Euler
        const worldRotation = new THREE.Euler().setFromQuaternion(worldQuaternion);

        console.log(`OBB Created - Center: (${worldCenter.x.toFixed(2)}, ${worldCenter.y.toFixed(2)}, ${worldCenter.z.toFixed(2)}) Extents: (${worldExtents.x.toFixed(2)}, ${worldExtents.y.toFixed(2)}, ${worldExtents.z.toFixed(2)})`);

        // Create and return the OBB
        return new OBB(worldCenter, worldExtents, worldRotation);
    }

    // Check if this OBB intersects with another OBB
    intersectsOBB(other) {
        const separation = new THREE.Vector3().subVectors(other.center, this.center);

        // Test separation along all 15 potential separating axes
        const axes = [...this.axes, ...other.axes];

        // Add cross products of axes
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const crossAxis = new THREE.Vector3().crossVectors(this.axes[i], other.axes[j]);
                if (crossAxis.lengthSq() > 0.0001) {
                    crossAxis.normalize();
                    axes.push(crossAxis);
                }
            }
        }

        for (const axis of axes) {
            if (!this.testSeparatingAxis(axis, other, separation)) {
                return false;
            }
        }

        return true;
    }

    testSeparatingAxis(axis, other, separation) {
        const projectedSeparation = Math.abs(separation.dot(axis));
        const projectedThis = this.getProjectedRadius(axis);
        const projectedOther = other.getProjectedRadius(axis);

        return projectedSeparation <= (projectedThis + projectedOther);
    }

    getProjectedRadius(axis) {
        return Math.abs(this.axes[0].dot(axis)) * this.extents.x +
            Math.abs(this.axes[1].dot(axis)) * this.extents.y +
            Math.abs(this.axes[2].dot(axis)) * this.extents.z;
    }

    // Check if a point is inside this OBB
    containsPoint(point) {
        const localPoint = new THREE.Vector3().subVectors(point, this.center);

        for (let i = 0; i < 3; i++) {
            const projection = localPoint.dot(this.axes[i]);
            if (Math.abs(projection) > this.extents.getComponent(i)) {
                return false;
            }
        }

        return true;
    }

    // Create debug wireframe mesh
    createDebugMesh(color = 0xff0000, opacity = 0.5) {
        const geometry = new THREE.BoxGeometry(this.extents.x * 2, this.extents.y * 2, this.extents.z * 2);
        const material = new THREE.MeshBasicMaterial({
            color: color,
            wireframe: true,
            transparent: true,
            opacity: opacity
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(this.center);
        mesh.rotation.copy(this.rotation);
        return mesh;
    }
}
/**
 * Dynamically shows or hides OBB debug meshes based on player proximity.
 * This function should be called every frame in the animate() loop.
 */
function updateDynamicDebugOBBs() {
    // If the debug feature is turned off, make sure to remove any leftover meshes.
    if (!window.DEBUG_COLLIDERS) {
        if (visibleDebugMeshes.size > 0) {
            visibleDebugMeshes.forEach(mesh => scene.remove(mesh));
            visibleDebugMeshes.clear();
        }
        return; // Do nothing else
    }

    const playerPosition = camera.position;
    const visibilityRadius = 50;
    const obbsThatShouldBeVisible = new Set();

    // 1. First, determine which OBBs are currently in range
    for (const obb of collisionOBBs) {
        if (playerPosition.distanceTo(obb.center) <= visibilityRadius) {
            obbsThatShouldBeVisible.add(obb);
        }
    }

    // 2. Remove debug meshes that are for OBBs no longer in range
    visibleDebugMeshes.forEach((mesh, obb) => {
        if (!obbsThatShouldBeVisible.has(obb)) {
            scene.remove(mesh);
            visibleDebugMeshes.delete(obb);
        }
    });

    // 3. Add new debug meshes for OBBs that have just come into range
    obbsThatShouldBeVisible.forEach(obb => {
        // Only create a mesh if it's not already visible
        if (!visibleDebugMeshes.has(obb)) {
            const debugMesh = obb.createDebugMesh();
            scene.add(debugMesh);
            visibleDebugMeshes.set(obb, debugMesh); // Add it to our tracking map
        }
    });
}

// Smart LOD Functions (work with existing model)
function initializeSmartLOD(rootObject) {
    console.log('Initializing Smart LOD system...');

    rootObject.traverse((child) => {
        if (child.isMesh && child.geometry) {
            // Store original geometry
            SMART_LOD.originalGeometries.set(child.uuid, {
                geometry: child.geometry.clone(),
                material: child.material,
                originalVertexCount: child.geometry.attributes.position.count
            });

            // Set initial LOD level
            SMART_LOD.meshLODLevels.set(child.uuid, 'full');
        }
    });

    console.log(`Smart LOD initialized for ${SMART_LOD.originalGeometries.size} meshes`);
}

function updateSmartLOD(playerPosition, delta) {
    if (!SMART_LOD.enabled) return;

    SMART_LOD.lastUpdate += delta;
    if (SMART_LOD.lastUpdate < SMART_LOD.updateInterval) return;

    SMART_LOD.lastUpdate = 0;

    // Update each mesh's LOD based on distance
    scene.traverse((child) => {
        if (child.isMesh && SMART_LOD.originalGeometries.has(child.uuid)) {
            updateMeshLOD(child, playerPosition);
        }
    });
}

function updateMeshLOD(mesh, playerPosition) {
    const distance = mesh.position.distanceTo(playerPosition);
    const currentLevel = SMART_LOD.meshLODLevels.get(mesh.uuid);
    let targetLevel;

    // Determine target LOD level
    if (distance > SMART_LOD.distances.minimal) {
        targetLevel = 'hidden';
    } else if (distance > SMART_LOD.distances.reduced) {
        targetLevel = 'minimal';
    } else if (distance > SMART_LOD.distances.full) {
        targetLevel = 'reduced';
    } else {
        targetLevel = 'full';
    }

    // Apply LOD change if needed
    if (currentLevel !== targetLevel) {
        applyLODLevel(mesh, targetLevel);
        SMART_LOD.meshLODLevels.set(mesh.uuid, targetLevel);
    }
}

function applyLODLevel(mesh, level) {
    const original = SMART_LOD.originalGeometries.get(mesh.uuid);

    switch (level) {
        case 'hidden':
            mesh.visible = false;
            SMART_LOD.culledMeshes.add(mesh.uuid);
            break;

        case 'minimal':
            mesh.visible = true;
            SMART_LOD.culledMeshes.delete(mesh.uuid);
            // Reduce geometry complexity by 75%
            simplifyGeometry(mesh, 0.25);
            // Lower texture resolution
            scaleMaterialTextures(mesh.material, 0.25);
            break;

        case 'reduced':
            mesh.visible = true;
            SMART_LOD.culledMeshes.delete(mesh.uuid);
            // Reduce geometry complexity by 50%
            simplifyGeometry(mesh, 0.5);
            // Medium texture resolution
            scaleMaterialTextures(mesh.material, 0.5);
            break;

        case 'full':
            mesh.visible = true;
            SMART_LOD.culledMeshes.delete(mesh.uuid);
            // Restore original geometry
            mesh.geometry.dispose();
            mesh.geometry = original.geometry.clone();
            // Restore full texture resolution
            scaleMaterialTextures(mesh.material, 1.0);
            break;
    }
}

function simplifyGeometry(mesh, quality) {
    const original = SMART_LOD.originalGeometries.get(mesh.uuid);
    const positions = original.geometry.attributes.position.array;
    const targetCount = Math.floor(positions.length * quality / 3) * 3; // Ensure multiple of 3

    if (targetCount < positions.length) {
        // Simple decimation - take every Nth vertex
        const step = Math.floor(positions.length / targetCount);
        const newPositions = [];

        for (let i = 0; i < positions.length; i += step * 3) {
            if (newPositions.length < targetCount) {
                newPositions.push(positions[i], positions[i + 1], positions[i + 2]);
            }
        }

        mesh.geometry.dispose();
        mesh.geometry = new THREE.BufferGeometry();
        mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
        mesh.geometry.computeVertexNormals();
    }
}

function scaleMaterialTextures(material, scale) {
    if (!material) return;

    // Handle both single materials and material arrays
    const materials = Array.isArray(material) ? material : [material];

    materials.forEach(mat => {
        if (mat.map && mat.map.image) {
            // This is a simplified approach - in practice you'd want texture mipmaps
            mat.map.magFilter = scale < 1 ? THREE.LinearFilter : THREE.LinearFilter;
            mat.map.minFilter = scale < 0.5 ? THREE.LinearMipMapLinearFilter : THREE.LinearMipMapLinearFilter;
        }
    });
}

// ✅ SMART LOADING MANAGER
const loadingManager = new THREE.LoadingManager(() => {
    console.log('All 3D assets loaded!');
    if (window.onAssetsLoaded) {
        window.onAssetsLoaded();
    }
});
// Add this new block of code to main.js

// Helper function to handle the smooth camera movement
// In main.js, REPLACE your old tweenCameraToView function with this:
// In main.js

// Helper function to handle the smooth camera movement
function tweenCameraToView(viewIndex) {
    if (viewIndex < 0 || viewIndex >= predefinedViews.length) return;

    // --- NEW TWEEN.JS LOGIC ---

    isTweeningCamera = true;
    orbitControls.enabled = false; // Disable user input during animation

    const view = predefinedViews[viewIndex];

    // Get the starting position and target
    const from = {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        targetX: orbitControls.target.x,
        targetY: orbitControls.target.y,
        targetZ: orbitControls.target.z
    };

    // Define the destination position and target
    const to = {
        x: view.position.x,
        y: view.position.y,
        z: view.position.z,
        targetX: view.lookAt.x,
        targetY: view.lookAt.y,
        targetZ: view.lookAt.z
    };

    // Create the animation
    new TWEEN.Tween(from)
        .to(to, 1500) // ✅ CONTROL SPEED HERE: 1500 is the duration in milliseconds (1.5 seconds)
        .easing(TWEEN.Easing.Quadratic.InOut) // ✅ CONTROL FADE: This provides the "fade-in/fade-out" effect
        .onUpdate((obj) => {
            // This function runs every frame of the animation
            camera.position.set(obj.x, obj.y, obj.z);
            orbitControls.target.set(obj.targetX, obj.targetY, obj.targetZ);
            orbitControls.update(); // Keep controls in sync
        })
        .onComplete(() => {
            // This function runs once the animation is finished
            isTweeningCamera = false;

            // THE PIVOT FIX: Set up the camera for 360-degree look-around
            const direction = new THREE.Vector3();
            camera.getWorldDirection(direction);
            orbitControls.target.copy(camera.position).add(direction);

            orbitControls.enabled = true; // Re-enable user controls
        })
        .start(); // Start the animation

    // ... (Your code for updating button styles remains the same)
    const viewButtons = document.querySelectorAll('.view-btn');
    viewButtons.forEach((btn, index) => {
        const nameSpan = btn.querySelector('.view-name');
        if (index === viewIndex) {
            btn.classList.add('active');
            nameSpan.textContent = view.name;
        } else {
            btn.classList.remove('active');
            nameSpan.textContent = '';
        }
    });
}

// Main function to activate the "Views" mode
// In main.js

function activateViewsMode() {
    document.getElementById('viewsContainer')?.classList.add('show');
    document.getElementById('desktopCameraModeButton')?.classList.add('disabled');
    document.getElementById('viewsModeButton')?.classList.remove('disabled');

    fpsControls.unlock && fpsControls.unlock();
    crosshair.style.display = 'none'; // Hide crosshair
    escHint.style.display = 'none'; // Hide ESC hint
    fpsControls.enabled = false;
    orbitControls.enabled = true; // Will be temporarily disabled by tween
    activeControls = orbitControls;

    // Configure controls for Views Mode
    orbitControls.enablePan = false;
    orbitControls.enableZoom = false;
    orbitControls.autoRotate = false;

    // --- THIS IS THE KEY FOR UNLOCKING THE VIEW ---
    // IMPORTANT: Explicitly unlock vertical rotation for free-look in this mode.
    orbitControls.minPolarAngle = 0;
    orbitControls.maxPolarAngle = Math.PI;

    console.log('Views Mode Activated');
    tweenCameraToView(0); // Move to the first view by default
}

// Make the function globally available for the button in index.html
// Add these lines at the end of your main.js file
// or after the function definitions.

window.activateOrbitControls = activateOrbitControls;
window.activateFPSControls = activateFPSControls;
window.activateViewsMode = activateViewsMode;

// Add event listeners for the view buttons once the document is loaded
document.addEventListener('DOMContentLoaded', () => {
    const viewButtons = document.querySelectorAll('.view-btn');
    viewButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const viewIndex = parseInt(btn.dataset.view, 10);
            tweenCameraToView(viewIndex);
        });
    });
});
loadingManager.onProgress = function (url, itemsLoaded, itemsTotal) {
    console.log(`Loading: ${itemsLoaded}/${itemsTotal} - ${url}`);
};

loadingManager.onError = function (url) {
    console.error('Error loading:', url);
};

// --------------------- Scene & Camera ---------------------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 550);
camera.position.set(280, 60, 100);
camera.lookAt(0, 0, 0);
camera.zoom = 1;



camera.updateProjectionMatrix();


// --------------------- Renderer ---------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Resolution
if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    renderer.setPixelRatio(window.devicePixelRatio * 0.75);
} else {
    renderer.setPixelRatio(window.devicePixelRatio * 1);
}

// then set size
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --------------------- Controls ---------------------
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.target.set(0, -20, 0);
orbitControls.dampingFactor = 0.05;
orbitControls.update();
const currentPolar = orbitControls.getPolarAngle(); // phi - vertical angle
orbitControls.minPolarAngle = currentPolar;
orbitControls.maxPolarAngle = currentPolar;
// Auto-Rotate
orbitControls.autoRotate = true;
orbitControls.autoRotateSpeed = -1.3; // Adjust speed as needed (default is 2.0)
orbitControls.enableZoom = false;
orbitControls.enablePan = false;



const fpsControls = new PointerLockControls(camera, renderer.domElement);
fpsControls.enabled = false;

// --------------------- Movement ---------------------
const move = { forward: false, backward: false, left: false, right: false };
let baseSpeed = 5, runSpeed = 10, isRunning = false;
let velocity = new THREE.Vector3(), direction = new THREE.Vector3();

// Jump / Gravity
let canJump = false, verticalVelocity = 0, gravity = -18, jumpStrength = 5.5;

// Bunny hop
let bunnyHopMultiplier = 1, maxBunnyHop = 3;

// Crouch
let isCrouching = false, crouchOffset = -0.7, crouchSpeed = 1, normalSpeed = baseSpeed;
let groundHeight = 1.85;

// --------------------- FIXED OBB COLLISION SYSTEM ---------------------
const collisionOBBs = [];

let playerOBB;

// Player collision properties
const playerRadius = 0.3;
const playerHeight = 1.5;        // Reduced from 1.8 to make player shorter
const cameraEyeHeight = 1.35;    // Reduced accordingly - eyes at realistic height
const playerFeetOffset = 0.05;   // Smaller offset to reduce bouncing


// Initialize player OBB
function initializePlayerOBB() {
    const playerExtents = new THREE.Vector3(playerRadius, playerHeight / 2, playerRadius);
    // Player OBB center should be at feet + half height
    const playerFeetY = camera.position.y - cameraEyeHeight;
    const playerCenter = new THREE.Vector3(
        camera.position.x,
        playerFeetY + playerHeight / 2,
        camera.position.z
    );
    const playerRotation = new THREE.Euler(0, 0, 0);

    playerOBB = new OBB(playerCenter, playerExtents, playerRotation);
}

// Update player OBB position
function updatePlayerOBB() {
    if (playerOBB) {
        const playerFeetY = camera.position.y - cameraEyeHeight;
        playerOBB.center.set(
            camera.position.x,
            playerFeetY + playerHeight / 2,
            camera.position.z
        );
        playerOBB.updateAxes();
    }
}

// Check horizontal collision using FIXED OBB
function checkHorizontalCollisionOBB(position) {
    if (!playerOBB) return false;

    const playerFeetY = position.y - cameraEyeHeight;
    const testOBB = new OBB(
        new THREE.Vector3(position.x, playerFeetY + playerHeight / 2, position.z),
        playerOBB.extents.clone(),
        new THREE.Euler(0, 0, 0)
    );

    for (const obb of collisionOBBs) {
        if (testOBB.intersectsOBB(obb)) {
            if (window.DEBUG_COLLISION_LOG) {
                console.log('Horizontal collision detected with OBB at:', obb.center);
            }
            return true;
        }
    }

    return false;
}
// Check vertical collision using FIXED OBB
function checkVerticalCollisionOBB(cameraPos, direction = 'down') {
    if (!playerOBB) return { collision: false, height: cameraPos.y };

    const playerFeetY = cameraPos.y - cameraEyeHeight;
    let testY;

    if (direction === 'up') {
        // Check head collision - test slightly above player head
        testY = playerFeetY + playerHeight + 0.1;
    } else {
        // Check foot collision - test at player feet level
        testY = playerFeetY;
    }

    const testOBB = new OBB(
        new THREE.Vector3(cameraPos.x, testY, cameraPos.z),
        new THREE.Vector3(playerRadius, 0.1, playerRadius), // Thin test volume
        new THREE.Euler(0, 0, 0)
    );

    let closestHeight = direction === 'up' ? Infinity : -Infinity;
    let hasCollision = false;

    for (const obb of collisionOBBs) {
        if (testOBB.intersectsOBB(obb)) {
            hasCollision = true;

            if (direction === 'up') {
                // Hit ceiling - find lowest ceiling point
                const ceilingY = obb.center.y - obb.extents.y;
                if (ceilingY < closestHeight) {
                    closestHeight = ceilingY;
                }
            } else {
                // Hit floor - find highest floor point  
                const floorY = obb.center.y + obb.extents.y;
                if (floorY > closestHeight) {
                    closestHeight = floorY;
                }
            }
        }
    }

    if (hasCollision) {
        if (direction === 'up') {
            // Return camera Y position (ceiling - player height + eye height)
            return {
                collision: true,
                height: closestHeight - playerHeight + cameraEyeHeight
            };
        } else {
            // Return camera Y position (floor + eye height + small offset)
            return {
                collision: true,
                height: closestHeight + cameraEyeHeight + playerFeetOffset
            };
        }
    }

    return {
        collision: false,
        height: cameraPos.y
    };
}


// Enhanced sliding collision with FIXED OBB
function getValidMovementOBB(currentPos, desiredPos) {
    // First check if desired position is valid
    if (!checkHorizontalCollisionOBB(desiredPos)) {
        return desiredPos;
    }

    // Try sliding along individual axes
    const deltaX = desiredPos.x - currentPos.x;
    const deltaZ = desiredPos.z - currentPos.z;

    // Try X movement only
    const xOnlyPos = new THREE.Vector3(currentPos.x + deltaX, currentPos.y, currentPos.z);
    if (!checkHorizontalCollisionOBB(xOnlyPos)) {
        return xOnlyPos;
    }

    // Try Z movement only  
    const zOnlyPos = new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z + deltaZ);
    if (!checkHorizontalCollisionOBB(zOnlyPos)) {
        return zOnlyPos;
    }

    // Try reduced movement (for better sliding)
    const reductionFactors = [0.8, 0.6, 0.4, 0.2];

    for (const factor of reductionFactors) {
        const reducedPos = new THREE.Vector3(
            currentPos.x + deltaX * factor,
            currentPos.y,
            currentPos.z + deltaZ * factor
        );

        if (!checkHorizontalCollisionOBB(reducedPos)) {
            return reducedPos;
        }

        // Try just X with reduced movement
        const reducedXPos = new THREE.Vector3(currentPos.x + deltaX * factor, currentPos.y, currentPos.z);
        if (!checkHorizontalCollisionOBB(reducedXPos)) {
            return reducedXPos;
        }

        // Try just Z with reduced movement
        const reducedZPos = new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z + deltaZ * factor);
        if (!checkHorizontalCollisionOBB(reducedZPos)) {
            return reducedZPos;
        }
    }

    // No valid movement found
    return currentPos;
}


// FIXED: Create OBB from mesh using proper 3-step process
function createOBBFromMesh(mesh) {
    return OBB.fromMesh(mesh);
}

// FIXED: Add mesh to OBB collision detection
function addToOBBCollision(mesh) {
    if (mesh.isMesh) {
        const obb = createOBBFromMesh(mesh);
        collisionOBBs.push(obb);
        console.log(`Added OBB collision: ${mesh.name || 'unnamed'}`);

        // Create debug visualization if enabled

    }
}

// --------------------- MOBILE CONTROLS ---------------------
let isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
let joystickActive = true;
let joystickVector = new THREE.Vector2(0, 0);
let rightTouchId = null;

// Touch controls
let touchStartX = 0, touchStartY = 0;
let touchCurrentX = 0, touchCurrentY = 0;
let touchLookSensitivity = 0.01;

function createMobileControls() {
    if (!isMobileDevice && window.innerWidth > 768) return;

    const controlsContainer = document.createElement('div');
    controlsContainer.style.cssText = `
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            height: 200px;
            pointer-events: none;
            z-index: 1000;
        `;

    // Joystick
    const joystickContainer = document.createElement('div');
    joystickContainer.style.cssText = `
            position: absolute;
            bottom: 36px;
            left: 40px;
            width: 120px;
            height: 120px;
            background: rgba(255, 255, 255, 0.2);
            border: 3px solid rgba(255, 255, 255, 0.4);
            border-radius: 50%;
            pointer-events: auto;
            touch-action: none;
        `;

    const joystickKnob = document.createElement('div');
    joystickKnob.style.cssText = `
            position: absolute;
            width: 55px;
            height: 55px;
            background: rgba(137, 137, 137, 0.8);
            border-radius: 50%;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            transition: all 0.1s ease;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        `;

    joystickContainer.appendChild(joystickKnob);

    // Jump Button
    const jumpButton = document.createElement('div');
    jumpButton.style.cssText = `
            position: absolute;
            bottom: 20px;
            right: 20px;
            width: 60px;
            height: 60px;
            background: rgba(76, 175, 80, 0.8);
            border: 3px solid rgba(76, 175, 80, 1);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 14px;
            pointer-events: auto;
            touch-action: none;
            user-select: none;
            font-family: 'Inter', sans-serif;
        `;
    jumpButton.textContent = 'JUMP';

    // Sprint Button
    const sprintButton = document.createElement('div');
    sprintButton.style.cssText = `
            position: absolute;
            bottom: 20px;
            right: 100px;
            width: 60px;
            height: 60px;
            background: rgba(255, 152, 0, 0.8);
            border: 3px solid rgba(255, 152, 0, 1);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 14px;
            pointer-events: auto;
            touch-action: none;
            user-select: none;
            font-family: 'Inter', sans-serif;
        `;
    sprintButton.textContent = 'SPRINT';


    controlsContainer.appendChild(joystickContainer);
    controlsContainer.appendChild(jumpButton);
    controlsContainer.appendChild(sprintButton);
    document.body.appendChild(controlsContainer);

    // Joystick Controls
    let joystickTouchId = null;
    const maxJoystickDistance = 60;

    function handleJoystickStart(e) {
        e.preventDefault();
        joystickActive = true;
        joystickTouchId = e.changedTouches ? e.changedTouches[0].identifier : null;
        joystickKnob.style.transition = 'none';
    }

    function handleJoystickMove(e) {
        if (!joystickActive) return;

        let clientX, clientY;
        if (e.changedTouches) {
            const touch = Array.from(e.changedTouches).find(t => t.identifier === joystickTouchId);
            if (!touch) return;
            clientX = touch.clientX;
            clientY = touch.clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        const rect = joystickContainer.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const deltaX = clientX - centerX;
        const deltaY = clientY - centerY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (distance <= maxJoystickDistance) {
            joystickKnob.style.transform = `translate(${deltaX - 25}px, ${deltaY - 25}px)`;
            joystickVector.set(deltaX / maxJoystickDistance, -deltaY / maxJoystickDistance);
        } else {
            const normalizedX = (deltaX / distance) * maxJoystickDistance;
            const normalizedY = (deltaY / distance) * maxJoystickDistance;
            joystickKnob.style.transform = `translate(${normalizedX - 25}px, ${normalizedY - 25}px)`;
            joystickVector.set(normalizedX / maxJoystickDistance, -normalizedY / maxJoystickDistance);
        }

        // Update movement state based on joystick
        const threshold = 0.2;
        move.forward = joystickVector.y > threshold;
        move.backward = joystickVector.y < -threshold;
        move.left = joystickVector.x < -threshold;
        move.right = joystickVector.x > threshold;
    }

    function handleJoystickEnd(e) {
        if (e.changedTouches && joystickTouchId !== null) {
            const touch = Array.from(e.changedTouches).find(t => t.identifier === joystickTouchId);
            if (!touch) return;
        }

        joystickActive = false;
        joystickTouchId = null;
        joystickKnob.style.transition = 'all 0.2s ease';
        joystickKnob.style.transform = 'translate(-50%, -50%)';
        joystickVector.set(0, 0);

        // Reset movement
        move.forward = false;
        move.backward = false;
        move.left = false;
        move.right = false;
    }

    // Touch events for joystick
    joystickContainer.addEventListener('touchstart', handleJoystickStart, { passive: false });
    joystickContainer.addEventListener('touchmove', handleJoystickMove, { passive: false });
    joystickContainer.addEventListener('touchend', handleJoystickEnd, { passive: false });

    // Mouse events for joystick (for testing on desktop)
    joystickContainer.addEventListener('mousedown', handleJoystickStart);
    document.addEventListener('mousemove', (e) => {
        if (joystickActive && !e.changedTouches) handleJoystickMove(e);
    });
    document.addEventListener('mouseup', (e) => {
        if (joystickActive && !e.changedTouches) handleJoystickEnd(e);
    });

    // Jump Button
    function handleJump(e) {
        e.preventDefault();
        if (canJump && !(false) && activeControls === fpsControls) {
            const headCheck = checkVerticalCollisionOBB(
                new THREE.Vector3(camera.position.x, camera.position.y + jumpStrength * 1, camera.position.z),
                'up'
            );
            if (!headCheck.collision) {
                verticalVelocity = jumpStrength;
                canJump = false;
                if (isRunning) bunnyHopMultiplier = Math.min(bunnyHopMultiplier * 1.1, maxBunnyHop);
            }
        }
        jumpButton.style.transform = 'scale(0.9)';
        setTimeout(() => {
            jumpButton.style.transform = 'scale(1)';
        }, 100);
    }

    jumpButton.addEventListener('touchstart', (e) => { e.preventDefault(); jumpPressed = true; });
    jumpButton.addEventListener('touchend', (e) => { e.preventDefault(); jumpPressed = false; });
    jumpButton.addEventListener('mousedown', (e) => { e.preventDefault(); jumpPressed = true; });
    jumpButton.addEventListener('mouseup', (e) => { e.preventDefault(); jumpPressed = false; });

    // jumpButton.addEventListener('touchstart', handleJump, { passive: false });
    // jumpButton.addEventListener('mousedown', handleJump);

    // Sprint Button
    function handleSprintStart(e) {
        e.preventDefault();
        isRunning = true;
        sprintButton.style.background = 'rgba(255, 152, 0, 1)';
        sprintButton.style.transform = 'scale(0.95)';
    }

    function handleSprintEnd(e) {
        e.preventDefault();
        isRunning = false;
        sprintButton.style.background = 'rgba(255, 152, 0, 0.8)';
        sprintButton.style.transform = 'scale(1)';
    }

    sprintButton.addEventListener('touchstart', function (e) {
        e.preventDefault();
        isRunning = !isRunning; // toggle
        sprintButton.style.background = isRunning
            ? 'rgba(255, 152, 0, 1)'
            : 'rgba(255, 152, 0, 0.8)';
        sprintButton.style.transform = isRunning
            ? 'scale(0.95)'
            : 'scale(1)';
    }, { passive: false });

    sprintButton.addEventListener('mousedown', function (e) {
        e.preventDefault();
        isRunning = !isRunning; // toggle
        sprintButton.style.background = isRunning
            ? 'rgba(255, 152, 0, 1)'
            : 'rgba(255, 152, 0, 0.8)';
        sprintButton.style.transform = isRunning
            ? 'scale(0.95)'
            : 'scale(1)';
    });
    // sprintButton.addEventListener('touchstart', handleSprintStart, { passive: false });
    // sprintButton.addEventListener('touchend', handleSprintEnd, { passive: false });
    // sprintButton.addEventListener('mousedown', handleSprintStart);
    // sprintButton.addEventListener('mouseup', handleSprintEnd);

    // Touch look controls for camera (when in FPS mode)
    let touchLookActive = false;
    let lastTouchX = 0, lastTouchY = 0;

    // Store pitch and yaw separately for proper FPS camera control
    let cameraPitch = 0;
    let cameraYaw = Math.PI / 2;

    renderer.domElement.addEventListener('touchstart', (e) => {
        if (activeControls !== fpsControls) return;
        for (let t of e.changedTouches) {
            if (joystickTouchId !== null && t.identifier === joystickTouchId) continue;

            if (rightTouchId === null && t.clientX > window.innerWidth / 2) {
                rightTouchId = t.identifier;
                touchLookActive = true;
                lastTouchX = t.clientX;
                lastTouchY = t.clientY;
            }
        }
    }, { passive: true });

    renderer.domElement.addEventListener('touchmove', (e) => {
        if (activeControls !== fpsControls) return;
        for (let t of e.changedTouches) {
            if (joystickTouchId !== null && t.identifier === joystickTouchId) {
                handleJoystickMove({ changedTouches: [t], preventDefault: () => { } });
                continue;
            }

            if (rightTouchId !== null && t.identifier === rightTouchId) {
                const deltaX = t.clientX - lastTouchX;
                const deltaY = t.clientY - lastTouchY;

                cameraYaw -= deltaX * touchLookSensitivity;
                cameraPitch -= deltaY * touchLookSensitivity;

                cameraPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraPitch));
                camera.rotation.order = 'YXZ';
                camera.rotation.y = cameraYaw;
                camera.rotation.x = cameraPitch;

                lastTouchX = t.clientX;
                lastTouchY = t.clientY;
            }
        }
    }, { passive: true });

    renderer.domElement.addEventListener('touchend', (e) => {
        for (let t of e.changedTouches) {
            if (joystickTouchId !== null && t.identifier === joystickTouchId) {
                handleJoystickEnd({ changedTouches: [t], preventDefault: () => { } });
                joystickTouchId = null;
            }

            if (rightTouchId !== null && t.identifier === rightTouchId) {
                rightTouchId = null;
                touchLookActive = false;
            }
        }
    }, { passive: true });
}

// Initialize mobile controls
createMobileControls();

// --------------------- CROSSHAIR ---------------------
function createCrosshair() {
    const crosshair = document.createElement('div');
    crosshair.id = 'crosshair';
    crosshair.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 4px;
        height: 4px;
        background: white;
        border-radius: 50%;
        pointer-events: none;
        z-index: 1500;
        display: none;
        border: 2px solid black;
        box-shadow: 0 0 2px rgba(0, 0, 0, 0.8);
    `;
    document.body.appendChild(crosshair);
    return crosshair;
}

const crosshair = createCrosshair();
// --------------------- ESC HINT POPUP ---------------------
function createEscHint() {
    const escHint = document.createElement('div');
    escHint.id = 'escHint';
    escHint.style.cssText = `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 10px 20px;
        border-radius: 8px;
        font-family: 'Inter', sans-serif;
        font-size: 14px;
        z-index: 1500;
        display: none;
        pointer-events: none;
        border: 1px solid rgba(255, 255, 255, 0.3);
        transition: opacity 0.5s ease;
    `;
    escHint.textContent = 'Press ESC to unlock cursor';
    document.body.appendChild(escHint);
    return escHint;
}

const escHint = createEscHint();

// Variable to track the timeout
let escHintTimeout = null;

// Function to show ESC hint with auto-hide
function showEscHint() {
    escHint.style.display = 'block';
    escHint.style.opacity = '1';

    // Clear any existing timeout
    if (escHintTimeout) {
        clearTimeout(escHintTimeout);
    }

    // Set new timeout to hide after 5 seconds
    escHintTimeout = setTimeout(() => {
        escHint.style.opacity = '0';
        setTimeout(() => {
            escHint.style.display = 'none';
        }, 500); // Wait for fade out animation
    }, 5000);
}

// --------------------- FULLSCREEN BUTTON ---------------------

function createFullscreenButton() {
    const fullscreenButton = document.createElement('div');
    fullscreenButton.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            width: 120px;
            height: 35px;
            background: rgba(33, 150, 243, 0.9);
            border: 2px solid rgba(33, 150, 243, 1);
            border-radius: 25px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 15px;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            cursor: pointer;
            user-select: none;
            z-index: 2000;
            transition: all 0.2s ease;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        `;
    fullscreenButton.textContent = 'FULLSCREEN';

    // Hover effects
    fullscreenButton.addEventListener('mouseenter', () => {

        fullscreenButton.style.transform = 'translateX(-50%) scale(1.05)';
        fullscreenButton.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.3)';
    });

    fullscreenButton.addEventListener('mouseleave', () => {
        fullscreenButton.style.transform = 'translateX(-50%) scale(1)';
        fullscreenButton.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
    });


    // Fullscreen functionality
    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            // Enter fullscreen
            document.documentElement.requestFullscreen().then(() => {
                fullscreenButton.textContent = 'EXIT';
                fullscreenButton.style.background = 'rgba(255, 152, 0, 0.9)';
                fullscreenButton.style.borderColor = 'rgba(255, 152, 0, 1)';
                fullscreenButton.style.width = '150px';
                console.log('Entered fullscreen mode');
            }).catch((err) => {
                console.error('Error attempting to enable fullscreen:', err);
            });
        } else {
            // Exit fullscreen
            document.exitFullscreen().then(() => {
                fullscreenButton.textContent = 'FULLSCREEN';
                fullscreenButton.style.background = 'rgba(33, 150, 243, 0.9)';
                fullscreenButton.style.borderColor = 'rgba(33, 150, 243, 1)';
                fullscreenButton.style.width = '120px';
                console.log('Exited fullscreen mode');
            }).catch((err) => {
                console.error('Error attempting to exit fullscreen:', err);
            });
        }
    }

    // Use touchend event for mobile to better capture tap completion and prevent 300ms delay
    fullscreenButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        toggleFullscreen();
    }, { passive: false });

    // Keep click event for desktop fallback
    fullscreenButton.addEventListener('click', toggleFullscreen);


    // Listen for fullscreen changes (when user presses ESC or F11)
    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            fullscreenButton.textContent = 'EXIT';
            fullscreenButton.style.background = 'rgba(255, 152, 0, 0.9)';
            fullscreenButton.style.borderColor = 'rgba(255, 152, 0, 1)';
            fullscreenButton.style.width = '120px';
        } else {
            fullscreenButton.textContent = 'FULLSCREEN';
            fullscreenButton.style.background = 'rgba(33, 150, 243, 0.9)';
            fullscreenButton.style.borderColor = 'rgba(33, 150, 243, 1)';
            fullscreenButton.style.width = '120px';
        }
    });

    // Add button to page
    document.body.appendChild(fullscreenButton);

    return fullscreenButton;
}

// Create fullscreen button
createFullscreenButton();

// --------------------- Keyboard Events (Enhanced with Arrow Keys) ---------------------
document.addEventListener('keydown', (e) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'AltRight', 'AltLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    switch (e.code) {
        // WASD Controls
        case 'KeyW':
        case 'ArrowUp':
            move.forward = true;
            break;
        case 'KeyS':
        case 'ArrowDown':
            move.backward = true;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            move.left = true;
            break;
        case 'KeyD':
        case 'ArrowRight':
            move.right = true;
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            isRunning = true;
            break;
        case 'Space':
            if (canJump && !(false)) {
                const headCheck = checkVerticalCollisionOBB(
                    new THREE.Vector3(camera.position.x, camera.position.y + jumpStrength * 0.1, camera.position.z),
                    'up'
                );
                if (!headCheck.collision) {
                    verticalVelocity = jumpStrength;
                    canJump = false;
                    if (isRunning) bunnyHopMultiplier = Math.min(bunnyHopMultiplier * 1.1, maxBunnyHop);
                } else {
                    console.log('Cannot jump - head collision detected');
                }
            }
            break;
        case 'AltRight':
        case 'AltLeft':
            verticalVelocity = 15;
            canJump = true;
            break;
    }
});

document.addEventListener('keyup', (e) => {
    switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
            move.forward = false;
            break;
        case 'KeyS':
        case 'ArrowDown':
            move.backward = false;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            move.left = false;
            break;
        case 'KeyD':
        case 'ArrowRight':
            move.right = false;
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            isRunning = false;
            break;
    }
});

// --------------------- Pointer Lock ---------------------
document.addEventListener('click', () => {
    if (activeControls === fpsControls && !isMobileDevice) fpsControls.lock();
});

// --------------------- Camera Mode Switching ---------------------
let activeControls = orbitControls;

// In main.js, replace the old function with this
function activateOrbitControls() {
    document.getElementById('viewsContainer')?.classList.remove('show');
    document.getElementById('desktopCameraModeButton')?.classList.remove('disabled');
    // This line correctly fades the "Views" button
    document.getElementById('viewsModeButton')?.classList.add('disabled');

    isTweeningCamera = false;
    crosshair.style.display = 'none'; // Hide crosshair
    escHint.style.display = 'none'; // Hide ESC hint
    // ... (rest of the function is the same)
    camera.position.set(280, 60, 100);
    fpsControls.unlock && fpsControls.unlock();
    fpsControls.enabled = false;
    orbitControls.enabled = true;
    activeControls = orbitControls;
    orbitControls.enablePan = true;
    orbitControls.enableZoom = true;
    orbitControls.autoRotate = true;
    orbitControls.target.set(0, -20, 0);
    orbitControls.update();
    const currentPolar = orbitControls.getPolarAngle();
    orbitControls.minPolarAngle = currentPolar;
    orbitControls.maxPolarAngle = currentPolar;
    camera.updateProjectionMatrix();
    console.log('Orbit Controls Activated');
}



function isInsideAreaXZ(position, cuboid) {
    if (!cuboid) return false;
    const box = new THREE.Box3().setFromObject(cuboid);
    const px = position.x;
    const pz = position.z;
    const min = box.min;
    const max = box.max;
    return px >= min.x && px <= max.x && pz >= min.z && pz <= max.z;
}
let wasInsideArea = false;

let currentAreaName = '';

function updateAreaPrompt() {
    if (yellowCuboids.length === 0) return;

    const pos = camera.position;
    let foundName = '';

    for (const cuboid of yellowCuboids) {
        if (
            pos.x >= cuboid.min.x && pos.x <= cuboid.max.x &&
            pos.z >= cuboid.min.z && pos.z <= cuboid.max.z
        ) {
            foundName = cuboid.name;
            break;
        }
    }

    if (foundName !== currentAreaName) {
        currentAreaName = foundName;
        if (foundName) {
            areaPrompt.textContent = foundName;
            areaPrompt.style.display = 'block';
            requestAnimationFrame(() => {
                areaPrompt.style.opacity = '1';
            });
        } else {
            areaPrompt.style.opacity = '0';
            setTimeout(() => {
                areaPrompt.style.display = 'none';
            }, 500); // Match this to your CSS transition duration
        }
    }

}


function createYellowCuboids() {
    if (yellowCuboids.length > 0) return; // Prevent duplicates



    const areas = [
        { min: new THREE.Vector3(102, 0.4, 5.5), max: new THREE.Vector3(112, 0.8, 9), name: 'Academic Block - 2' },
        { min: new THREE.Vector3(97.57, 0.4, -9.56), max: new THREE.Vector3(102.38, 0.8, -5.19), name: 'Academic Block - 1' },
        { min: new THREE.Vector3(163, 0.4, -3.46), max: new THREE.Vector3(168.75, 0.8, 3.38), name: 'Welcome to G.L. Bajaj!' },
        { min: new THREE.Vector3(158.52, 0.4, -3.46), max: new THREE.Vector3(162.16, 0.8, 3.38), name: 'Gate No. - 1' },
        { min: new THREE.Vector3(35.84, 0.4, -30.36), max: new THREE.Vector3(39.26, 0.8, -28.75), name: 'Futsal Court' },
        { min: new THREE.Vector3(12.45, 0.4, -68.00), max: new THREE.Vector3(14.26, 0.8, -65.85), name: 'Basketball Court' },
        { min: new THREE.Vector3(12.66, 0.4, -84.81), max: new THREE.Vector3(14.26, 0.8, -82.32), name: 'Badminton Court' },
        { min: new THREE.Vector3(12.66, 0.4, -87.72), max: new THREE.Vector3(14.26, 0.8, -85.46), name: 'Volleyball Court' },
        { min: new THREE.Vector3(130.66, 0.4, -54.35), max: new THREE.Vector3(138.23, 0.8, -49.51), name: 'Academic Block - 1' },
        { min: new THREE.Vector3(21.83, 0.4, -61.84), max: new THREE.Vector3(25.76, 0.8, -59.18), name: 'Dept. of Mech. Engineering' },
        { min: new THREE.Vector3(44.58, 0.4, -61.84), max: new THREE.Vector3(48.41, 0.8, -59.18), name: 'Dept. of Mech. Engineering' },
        { min: new THREE.Vector3(150.15, 0.4, 14.58), max: new THREE.Vector3(153.07, 0.8, 17.77), name: 'Jai Hind!' },
        { min: new THREE.Vector3(70.72, 0.4, -112.20), max: new THREE.Vector3(76.11, 0.8, -107.28), name: 'Day-Scholar Mess' },
        { min: new THREE.Vector3(37.38, 0.4, -3.59), max: new THREE.Vector3(43.34, 0.8, 0.83), name: 'Main Ground' },
        { min: new THREE.Vector3(66.93, 0.4, 16.53), max: new THREE.Vector3(69.02, 0.8, 26.09), name: 'Library' },
        { min: new THREE.Vector3(75.24, 0.4, 38.96), max: new THREE.Vector3(78.85, 0.8, 42.65), name: 'MBA Canteen' },
        { min: new THREE.Vector3(107.67, 0.4, -6.22), max: new THREE.Vector3(109.35, 0.8, -4.06), name: 'Fee Counter' },
        { min: new THREE.Vector3(57.81, 0.4, -118.35), max: new THREE.Vector3(64.47, 0.8, -111.12), name: 'Gate No. - 2' },
        { min: new THREE.Vector3(8.38, 0.4, 51.53), max: new THREE.Vector3(12.02, 0.8, 58.02), name: 'Main Ground' },
        { min: new THREE.Vector3(96.45, 0.4, -97.79), max: new THREE.Vector3(103.50, 0.8, -94.27), name: 'Academic Block - 1' },
        { min: new THREE.Vector3(65.68, 0.4, -54.77), max: new THREE.Vector3(68.19, 0.8, -49.24), name: 'Academic Block - 1' },
        { min: new THREE.Vector3(57.22, 0.4, -48.71), max: new THREE.Vector3(60.71, 0.8, -45.66), name: 'Boys Hostel - 1' },
        { min: new THREE.Vector3(41.45, 0.4, 85.92), max: new THREE.Vector3(45.60, 0.8, 87.71), name: 'Boys Hostel - 2' },
        { min: new THREE.Vector3(87.98, 0.4, 34.52), max: new THREE.Vector3(93.36, 0.8, 39.24), name: 'Academic Block - 2' },
        { min: new THREE.Vector3(67.74, 0.4, 93.27), max: new THREE.Vector3(70.68, 0.8, 96.96), name: 'Rainwater Harvesting' },
        { min: new THREE.Vector3(-23.51, 0.4, 113.91), max: new THREE.Vector3(-17.21, 0.8, 123.18), name: 'Gate No. - 3' },
        { min: new THREE.Vector3(-26.29, 0.4, 58.42), max: new THREE.Vector3(-20.45, 0.8, 62.54), name: 'BCA/MCA Building' },
        { min: new THREE.Vector3(63.31, 0.4, 22.59), max: new THREE.Vector3(66.29, 0.8, 28.00), name: 'Main Ground' },
        { min: new THREE.Vector3(-167.89, 0.4, 18.19), max: new THREE.Vector3(-154.83, 0.8, 28.52), name: 'Girls Hostel Gate' },
        { min: new THREE.Vector3(-29.20, 0.4, 25.61), max: new THREE.Vector3(-22.52, 0.8, 34.33), name: 'Girls Hostel Gate' },
        { min: new THREE.Vector3(-30.38, 0.4, -8.00), max: new THREE.Vector3(-25.14, 0.8, -0.34), name: 'Girls Hostel' },

        // Add more building areas here
    ];

    areas.forEach(area => {
        const size = new THREE.Vector3().subVectors(area.max, area.min);
        const center = new THREE.Vector3().addVectors(area.min, area.max).multiplyScalar(0.5);

        const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.15
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(center);
        scene.add(mesh);

        yellowCuboids.push({ mesh, name: area.name, min: area.min, max: area.max });
    });
}

// In main.js, replace the old function with this
function activateFPSControls() {
    document.getElementById('viewsContainer')?.classList.remove('show');
    document.getElementById('desktopCameraModeButton')?.classList.remove('disabled');
    // This line correctly fades the "Views" button
    document.getElementById('viewsModeButton')?.classList.add('disabled');

    isTweeningCamera = false;
    crosshair.style.display = 'block'; // Show crosshair
    showEscHint(); // Show ESC hint with auto-hide    // ... (rest of the function is the same)
    orbitControls.enabled = false;
    orbitControls.autoRotate = false;
    fpsControls.enabled = true;
    activeControls = fpsControls;
    camera.position.set(172.0, 1.85, 0);
    console.log('FPS Controls Activated');
    camera.lookAt(0, 0, 0);
    camera.rotation.set(0, Math.PI / 2, 0);
    if (!playerOBB) {
        initializePlayerOBB();
    }
    createYellowCuboids();
}

window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyO') activateOrbitControls();
    if (e.code === 'KeyP') activateFPSControls();

    // Debug key to toggle OBB visualization
    if (e.code === 'KeyB') {
        window.DEBUG_COLLIDERS = !window.DEBUG_COLLIDERS;
        console.log('Dynamic Debug OBBs:', window.DEBUG_COLLIDERS ? 'ON' : 'OFF');
    }

    // Debug collision logging
    if (e.code === 'KeyL') {
        window.DEBUG_COLLISION_LOG = !window.DEBUG_COLLISION_LOG;
        console.log('Collision logging:', window.DEBUG_COLLISION_LOG);
    }

    // Show current player position and collision info
    if (e.code === 'KeyI') {
        console.log(`Player position: ${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)}`);
        console.log(`Ground height: ${groundHeight}`);
        console.log(`Total collision OBBs: ${collisionOBBs.length}`);

        // Test collision at current position
        const hasCollision = checkHorizontalCollisionOBB(camera.position);
        console.log(`OBB collision at current position: ${hasCollision}`);

        // Test head collision
        const headCheck = checkVerticalCollisionOBB(
            new THREE.Vector3(camera.position.x, camera.position.y + playerHeight, camera.position.z),
            'up'
        );
        console.log(`Head collision test: ${headCheck.collision}`);
    }
});

if (document.getElementById("cameraView")) {
    document.getElementById("cameraView").addEventListener("change", (e) => {
        if (e.target.value === "orbit") activateOrbitControls();
        if (e.target.value === "fps") activateFPSControls();
    });
}

// --------------------- GLTF Loader with FIXED OBB Collision Detection ---------------------
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

        // Initialize Smart LOD system BEFORE collision setup
        initializeSmartLOD(gltf.scene);

        // Wait a frame for transformations to apply, then setup FIXED OBB collision detection
        requestAnimationFrame(() => {
            console.log('Setting up FIXED OBB collision detection...');

            gltf.scene.traverse((child) => {
                if (child.isMesh) {
                    console.log(`Processing mesh: ${child.name}, vertices: ${child.geometry.attributes.position.count}, rotation: (${child.rotation.x.toFixed(2)}, ${child.rotation.y.toFixed(2)}, ${child.rotation.z.toFixed(2)})`);

                    let shouldAddToCollision = false;

                    // Method 1: Objects with "COLLIDER" in name
                    if (child.name && child.name.includes("COLLIDER")) {
                        shouldAddToCollision = true;
                        child.visible = false; // Hide collision meshes
                        console.log(`Added COLLIDER mesh: ${child.name}`);
                    }
                    // Method 2: Specific collision objects
                    else if (child.name && (
                        child.name.toLowerCase().includes("roof") ||
                        child.name.toLowerCase().includes("ceiling") ||
                        child.name.toLowerCase().includes("top") ||
                        child.name.toLowerCase().includes("wall") ||
                        child.name.toLowerCase().includes("floor") ||
                        child.name.toLowerCase().includes("building") ||
                        child.name.toLowerCase().includes("structure") ||
                        child.name.toLowerCase().includes("collide")
                    )) {
                        shouldAddToCollision = true;
                        console.log(`Added named collision mesh: ${child.name}`);
                    }
                    // Method 3: Auto-detect large static meshes (but skip transparent materials)
                    else if (child.geometry && child.material) {
                        // Skip transparent materials to avoid alpha collision issues
                        const isTransparent = child.material.transparent ||
                            child.material.opacity < 1 ||
                            (child.material.map && child.material.map.format === THREE.RGBAFormat);

                        if (true) {
                            const meshBox = new THREE.Box3().setFromObject(child);
                            const size = meshBox.getSize(new THREE.Vector3());

                            // If object is large enough and not likely to be a small detail, treat as collidable
                            shouldAddToCollision = true;
                            console.log(`Added auto-detected mesh: ${child.name || 'unnamed'} (size: ${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)})`);
                        }
                    }

                    if (shouldAddToCollision) {
                        addToOBBCollision(child);
                    }
                }
            });

            console.log(`FIXED OBB setup complete. Total collision OBBs: ${collisionOBBs.length}`);

            // List all collision OBBs for debugging
            console.log('Collision OBBs:');
            collisionOBBs.forEach((obb, index) => {
                const size = new THREE.Vector3(obb.extents.x * 2, obb.extents.y * 2, obb.extents.z * 2);
                console.log(`  ${index}: center (${obb.center.x.toFixed(1)}, ${obb.center.y.toFixed(1)}, ${obb.center.z.toFixed(1)}) size: ${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)}`);
            });
        });
    },
    (progress) => {
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



// CAMERA SHAKING

// SAFE Camera shake system that won't interfere with collision detection
// This uses a separate shake camera that renders the scene with offset

// Camera shake variables
let cameraShake = {
    enabled: true,
    intensity: 0,
    frequency: 0,
    time: 0,
    walkShakeIntensity: 0.04,//0.06
    sprintShakeIntensity: 0.08,//0.1
    walkShakeFrequency: 8,
    sprintShakeFrequency: 12,
    landShakeIntensity: 0.08,
    landShakeDuration: 0.15,
    currentLandShake: 0,
    landShakeDecay: 0,
    shakeOffset: new THREE.Vector3()
};

// Track movement state for shake
let movementState = {
    isMoving: false,
    wasMoving: false,
    wasOnGround: false,
    landingVelocity: 0
};

// Calculate camera shake offset (doesn't modify camera position)
function calculateCameraShake(delta) {
    if (!cameraShake.enabled || activeControls !== fpsControls) {
        cameraShake.shakeOffset.set(0, 0, 0);
        return;
    }

    // Update shake time
    cameraShake.time += delta;

    // Calculate total shake intensity
    let totalIntensity = cameraShake.intensity;

    // Add landing shake
    // In calculateCameraShake, use exponential decay instead of linear:
    if (cameraShake.currentLandShake > 0) {
        totalIntensity += cameraShake.currentLandShake;
        // Exponential decay feels more natural
        cameraShake.currentLandShake *= Math.pow(0.01, delta / cameraShake.landShakeDuration);
        if (cameraShake.currentLandShake < 0.001) {
            cameraShake.currentLandShake = 0;
        }
    }

    if (totalIntensity > 0) {
        // Generate shake offset using sine waves for smooth motion
        const shakeX = Math.sin(cameraShake.time * cameraShake.frequency) * totalIntensity;
        const shakeY = Math.sin(cameraShake.time * cameraShake.frequency * 1.3) * totalIntensity * 0.7;
        const shakeZ = Math.cos(cameraShake.time * cameraShake.frequency * 0.8) * totalIntensity * 0.5;

        cameraShake.shakeOffset.set(shakeX, shakeY, shakeZ);
    } else {
        cameraShake.shakeOffset.set(0, 0, 0);
    }
}

// Update movement-based camera shake
function updateMovementShake() {
    if (activeControls !== fpsControls) {
        cameraShake.intensity = 0;
        cameraShake.frequency = 0;
        return;
    }

    // Check if player is moving
    movementState.isMoving = move.forward || move.backward || move.left || move.right;

    if (movementState.isMoving && canJump) { // Only shake when on ground and moving
        if (isRunning) {
            // Sprint shake
            cameraShake.intensity = cameraShake.sprintShakeIntensity;
            cameraShake.frequency = cameraShake.sprintShakeFrequency;
        } else {
            // Walk shake
            cameraShake.intensity = cameraShake.walkShakeIntensity;
            cameraShake.frequency = cameraShake.walkShakeFrequency;
        }
    } else {
        // Gradually reduce shake when not moving
        cameraShake.intensity *= 0.9;
        if (cameraShake.intensity < 0.001) {
            cameraShake.intensity = 0;
        }
    }

    movementState.wasMoving = movementState.isMoving;
}

// Detect landing and trigger landing shake
function checkLandingShake() {
    if (activeControls !== fpsControls) return;

    // Check if player just landed
    if (!movementState.wasOnGround && canJump && verticalVelocity <= 0) {
        // Calculate landing intensity based on falling velocity
        const fallVelocity = Math.abs(movementState.landingVelocity);

        if (fallVelocity > 2) { // Only shake for significant falls
            const intensity = Math.min(fallVelocity * 0.005, cameraShake.landShakeIntensity);

            // Trigger landing shake
            cameraShake.currentLandShake = intensity;
            cameraShake.landShakeDecay = intensity / cameraShake.landShakeDuration;

            console.log(`Landing shake triggered - velocity: ${fallVelocity.toFixed(2)}, intensity: ${intensity.toFixed(3)}`);
        }
    }

    // Store landing velocity for next frame
    movementState.landingVelocity = verticalVelocity;
    movementState.wasOnGround = canJump;
}

// --------------------- Animation Loop with FIXED OBB Collision ---------------------
const clock = new THREE.Clock();

// In main.js, inside the animate() function

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    TWEEN.update();
    // --- REPLACE THE OLD isTweeningCamera BLOCK WITH THIS ---

    if (activeControls === fpsControls) {
        // ... (rest of your animate function for FPS mode is fine)
        const originalPosition = camera.position.clone();
        updateAreaPrompt();
        updatePlayerOBB();
        velocity.set(0, 0, 0);
        direction.set(0, 0, 0);
        if (move.forward) direction.z -= 1;
        if (move.backward) direction.z += 1;
        if (move.left) direction.x -= 1;
        if (move.right) direction.x += 1;
        direction.normalize();
        const currentSpeed = (isRunning ? runSpeed : baseSpeed) * bunnyHopMultiplier;
        const moveDistance = currentSpeed * delta;
        const forward = new THREE.Vector3();
        const right = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0));
        right.normalize();
        const currentPos = camera.position.clone();
        const desiredPos = currentPos.clone();
        desiredPos.add(forward.clone().multiplyScalar(-direction.z * moveDistance));
        desiredPos.add(right.clone().multiplyScalar(direction.x * moveDistance));
        const validPos = getValidMovementOBB(currentPos, desiredPos);
        camera.position.copy(validPos);
        verticalVelocity += gravity * delta;
        const nextY = camera.position.y + verticalVelocity * delta;
        const nextPos = new THREE.Vector3(camera.position.x, nextY, camera.position.z);
        if (verticalVelocity > 0) {
            const upCheck = checkVerticalCollisionOBB(nextPos, 'up');
            if (upCheck.collision) {
                verticalVelocity = 0;
                camera.position.y = upCheck.height - playerHeight - 0.1;
                console.log('Head hit ceiling at Y:', upCheck.height);
            } else {
                camera.position.y = nextY;
            }
        } else {
            const downCheck = checkVerticalCollisionOBB(nextPos, 'down');
            if (downCheck.collision) {
                verticalVelocity = 0;
                canJump = true;
                camera.position.y = downCheck.height;
                if (isRunning && (!move.forward || !move.backward || !move.left || !move.right)) {
                    bunnyHopMultiplier = 1;
                }
            } else {
                camera.position.y = nextY;
            }
        }
        let currentGround = (false) ? groundHeight + crouchOffset : groundHeight;
        if (camera.position.y <= currentGround) {
            camera.position.y = currentGround;
            verticalVelocity = 0;
            canJump = true;
            if (!move.forward && !move.backward && !move.left && !move.right) {
                bunnyHopMultiplier = 1;
            }
        }
        checkLandingShake();
        updateMovementShake();
        calculateCameraShake(delta);
        if (cameraShake.shakeOffset.lengthSq() > 0) {
            camera.position.add(cameraShake.shakeOffset);
        }
    } else {
        // This update handles user input when not tweening
        if (!isTweeningCamera) {
            orbitControls.update();
        }
    }
    updateDynamicDebugOBBs();

    renderer.render(scene, camera);

    if (activeControls === fpsControls && cameraShake.shakeOffset.lengthSq() > 0) {
        camera.position.sub(cameraShake.shakeOffset);
    }

    if (jumpPressed && canJump) {
        const headCheck = checkVerticalCollisionOBB(new THREE.Vector3(camera.position.x, camera.position.y + jumpStrength * 1, camera.position.z), 'up');
        if (!headCheck.collision) {
            verticalVelocity = jumpStrength;
            canJump = false;
            if (isRunning) {
                bunnyHopMultiplier = Math.min(bunnyHopMultiplier * 1.1, maxBunnyHop);
            }
        }
    }
}

// Start animation loop
animate();

// --------------------- Helper Functions for Manual Setup ---------------------

// Function to manually add collision objects (call this from console)
window.addOBBCollision = function (objectName) {
    const object = scene.getObjectByName(objectName);
    if (object && object.isMesh) {
        addToOBBCollision(object);
        console.log(`Manually added ${objectName} to FIXED OBB collision detection`);
    } else {
        console.log(`Object ${objectName} not found or is not a mesh`);
    }
};

// Function to remove collision objects
window.removeOBBCollision = function (objectName) {
    const object = scene.getObjectByName(objectName);
    if (object) {
        const index = collisionOBBs.findIndex(obb => {
            // Find OBB that matches this object's world position
            const objectBox = new THREE.Box3().setFromObject(object);
            const objectCenter = objectBox.getCenter(new THREE.Vector3());
            return obb.center.distanceTo(objectCenter) < 0.1;
        });

        if (index !== -1) {
            collisionOBBs.splice(index, 1);
            console.log(`Removed ${objectName} from FIXED OBB collision detection`);

            // Remove debug mesh if exists
            if (debugMeshes[index]) {
                scene.remove(debugMeshes[index]);
                debugMeshes.splice(index, 1);
            }
        }
    } else {
        console.log(`Object ${objectName} not found`);
    }
};

// Function to clear all collision objects
window.clearAllOBBCollisions = function () {
    collisionOBBs.length = 0;
    console.log('All FIXED OBB collision objects cleared');

    // Remove debug visualizations
    debugMeshes.forEach(mesh => scene.remove(mesh));
    debugMeshes.length = 0;
};

// Function to list all collision objects
window.listOBBCollisions = function () {
    console.log(`Total FIXED OBB collision objects: ${collisionOBBs.length}`);
    collisionOBBs.forEach((obb, index) => {
        const size = new THREE.Vector3(obb.extents.x * 2, obb.extents.y * 2, obb.extents.z * 2);
        const rotation = new THREE.Vector3(obb.rotation.x, obb.rotation.y, obb.rotation.z);
        console.log(`${index}: center (${obb.center.x.toFixed(1)}, ${obb.center.y.toFixed(1)}, ${obb.center.z.toFixed(1)}) - size: ${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)} - rotation: (${rotation.x.toFixed(2)}, ${rotation.y.toFixed(2)}, ${rotation.z.toFixed(2)})`);
    });
};

// Function to test collision at specific position
window.testOBBCollisionAt = function (x, y, z) {
    const testPos = new THREE.Vector3(x, y, z);
    const hasCollision = checkHorizontalCollisionOBB(testPos);
    console.log(`FIXED OBB collision at (${x}, ${y}, ${z}): ${hasCollision}`);
    return hasCollision;
};

// Add helper functions for debugging
window.testOBBHeadCollision = function () {
    const headCheck = checkVerticalCollisionOBB(
        new THREE.Vector3(camera.position.x, camera.position.y + playerHeight, camera.position.z),
        'up'
    );
    console.log('FIXED OBB head collision test:', headCheck);
};

window.testOBBJump = function () {
    console.log('Testing FIXED OBB collision with jump...');
    verticalVelocity = 10;
    canJump = false;
};

// Function to test and compare OBB creation methods
window.debugOBBCreation = function (meshName) {
    const mesh = scene.getObjectByName(meshName);
    if (!mesh || !mesh.isMesh) {
        console.log(`Mesh ${meshName} not found`);
        return;
    }

    console.log('=== DEBUGGING OBB CREATION ===');
    console.log('Mesh:', meshName);
    console.log('Position:', mesh.position);
    console.log('Rotation:', mesh.rotation);
    console.log('Scale:', mesh.scale);

    // Test the FIXED OBB creation
    const fixedOBB = OBB.fromMesh(mesh);
    console.log('FIXED OBB Result:', fixedOBB);

    // Create debug visualization
    const debugMesh = fixedOBB.createDebugMesh(0x00ff00, 0.8);
    scene.add(debugMesh);
    console.log('Added green debug visualization');

    return fixedOBB;
};