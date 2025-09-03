import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

// ✅ SMART LOADING MANAGER
const loadingManager = new THREE.LoadingManager(() => {
    console.log('All 3D assets loaded!');
    if (window.onAssetsLoaded) {
        window.onAssetsLoaded();
    }
});

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

// --------------------- ENHANCED COLLISION SYSTEM ---------------------
const collidableObjects = [];
const colliderBoxes = [];
const cameraBox = new THREE.Box3();

// Enhanced collision box - more realistic player size
const cameraBoxSize = new THREE.Vector3(0.8, 1.8, 0.8); // Taller for better head collision
const collisionMargin = 0.05;

// FIXED: Separate collision detection for different movement types
function checkHorizontalCollision(position) {
    const testBox = cameraBox.clone();
    testBox.setFromCenterAndSize(
        new THREE.Vector3(position.x, position.y + cameraBoxSize.y / 2, position.z),
        new THREE.Vector3(cameraBoxSize.x, cameraBoxSize.y, cameraBoxSize.z)
    );

    for (let i = 0; i < colliderBoxes.length; i++) {
        if (testBox.intersectsBox(colliderBoxes[i])) {
            return true;
        }
    }
    return false;
}

// FIXED: Dedicated vertical collision check for jumping/falling
function checkVerticalCollision(position, direction = 'up') {
    const testBox = cameraBox.clone();
    
    // For upward movement (jumping), check from head position
    // For downward movement (falling), check from feet position
    let testY = position.y + cameraBoxSize.y / 2;
    if (direction === 'down') {
        testY = position.y;
    }
    
    testBox.setFromCenterAndSize(
        new THREE.Vector3(position.x, testY, position.z),
        cameraBoxSize
    );

    for (let i = 0; i < colliderBoxes.length; i++) {
        if (testBox.intersectsBox(colliderBoxes[i])) {
            if (window.DEBUG_COLLISION_LOG) {
                const colliderCenter = colliderBoxes[i].getCenter(new THREE.Vector3());
                console.log(`${direction} collision at player Y: ${position.y.toFixed(2)} with collider at Y: ${colliderCenter.y.toFixed(2)}`);
            }
            return { collision: true, box: colliderBoxes[i] };
        }
    }
    return { collision: false, box: null };
}

// FIXED: Better head collision detection
function checkHeadCollision(position) {
    const headTestBox = new THREE.Box3();
    const headHeight = 0.3; // Small box at head level
    
    headTestBox.setFromCenterAndSize(
        new THREE.Vector3(
            position.x, 
            position.y + cameraBoxSize.y - headHeight/2, // At head level
            position.z
        ),
        new THREE.Vector3(cameraBoxSize.x, headHeight, cameraBoxSize.z)
    );

    for (let i = 0; i < colliderBoxes.length; i++) {
        if (headTestBox.intersectsBox(colliderBoxes[i])) {
            return { collision: true, box: colliderBoxes[i] };
        }
    }
    return { collision: false, box: null };
}

// Function to create collision boxes with proper positioning fixes
function createCollisionBoxesFromMesh(mesh) {
    mesh.updateMatrixWorld(true);
    
    const box = new THREE.Box3().setFromObject(mesh);
    
    // Expand the box slightly for better collision detection
    box.expandByScalar(collisionMargin);

    colliderBoxes.push(box);
    console.log(`Added collision box for: ${mesh.name}`);
    console.log(`Box bounds: min(${box.min.x.toFixed(2)}, ${box.min.y.toFixed(2)}, ${box.min.z.toFixed(2)}) max(${box.max.x.toFixed(2)}, ${box.max.y.toFixed(2)}, ${box.max.z.toFixed(2)})`);

    // Optional: Create visual debug box
    if (window.DEBUG_COLLIDERS) {
        const boxGeometry = new THREE.BoxGeometry(
            box.max.x - box.min.x,
            box.max.y - box.min.y,
            box.max.z - box.min.z
        );
        const boxMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            wireframe: true,
            transparent: true,
            opacity: 0.3
        });
        const debugBox = new THREE.Mesh(boxGeometry, boxMaterial);
        debugBox.position.copy(box.getCenter(new THREE.Vector3()));
        scene.add(debugBox);
    }
}

// FIXED: Sliding collision with separate horizontal movement
function getValidMovement(currentPos, desiredPos) {
    // Try full movement first
    if (!checkHorizontalCollision(desiredPos)) {
        return desiredPos;
    }

    // Try X-axis movement only
    const xOnlyPos = new THREE.Vector3(desiredPos.x, currentPos.y, currentPos.z);
    if (!checkHorizontalCollision(xOnlyPos)) {
        return xOnlyPos;
    }

    // Try Z-axis movement only
    const zOnlyPos = new THREE.Vector3(currentPos.x, currentPos.y, desiredPos.z);
    if (!checkHorizontalCollision(zOnlyPos)) {
        return zOnlyPos;
    }

    // No valid movement
    return currentPos;
}

// Function to manually adjust collision box positions
function adjustCollisionBoxHeight(yOffset) {
    colliderBoxes.forEach((box, index) => {
        box.min.y += yOffset;
        box.max.y += yOffset;
        console.log(`Adjusted collision box ${index} by ${yOffset} units`);
    });
    
    // Update debug visualizations if they exist
    if (window.DEBUG_COLLIDERS) {
        // Remove existing debug boxes
        const debugBoxes = scene.children.filter(child =>
            child.material && child.material.wireframe && 
            (child.material.color.getHex() === 0xff0000 || child.material.color.getHex() === 0x00ff00)
        );
        debugBoxes.forEach(box => scene.remove(box));
        
        // Re-create debug boxes with new positions
        colliderBoxes.forEach((box, index) => {
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            
            const boxGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
            const boxMaterial = new THREE.MeshBasicMaterial({
                color: 0xff0000,
                wireframe: true,
                transparent: true,
                opacity: 0.3
            });
            const debugBox = new THREE.Mesh(boxGeometry, boxMaterial);
            debugBox.position.copy(center);
            scene.add(debugBox);
        });
    }
}

// --------------------- Keyboard Events ---------------------
document.addEventListener('keydown', (e) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyC', 'AltRight'].includes(e.code)) e.preventDefault();
    switch (e.code) {
        case 'KeyW': move.forward = true; break;
        case 'KeyS': move.backward = true; break;
        case 'KeyA': move.left = true; break;
        case 'KeyD': move.right = true; break;
        case 'ShiftLeft':
        case 'ShiftRight': isRunning = true; break;
        case 'Space':
            if (canJump && !isCrouching) {
                // FIXED: Check for head collision before jumping
                const headCheck = checkHeadCollision(camera.position);
                if (!headCheck.collision) {
                    verticalVelocity = jumpStrength; 
                    canJump = false;
                    if (isRunning) bunnyHopMultiplier = Math.min(bunnyHopMultiplier * 1.1, maxBunnyHop);
                } else {
                    console.log('Cannot jump - head collision detected');
                }
            }
            break;
        case 'KeyC':
            if (!isCrouching) {
                isCrouching = true;
                camera.position.y += crouchOffset;
                normalSpeed = baseSpeed;
                baseSpeed = crouchSpeed;
            }
            break;
        case 'AltRight':
            {
                verticalVelocity = 15; canJump = true;
            }
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
            if (isCrouching) {
                // FIXED: Check if there's enough space to stand up
                const standUpPos = new THREE.Vector3(camera.position.x, camera.position.y - crouchOffset, camera.position.z);
                const headCheck = checkHeadCollision(standUpPos);
                
                if (!headCheck.collision) {
                    isCrouching = false;
                    camera.position.y -= crouchOffset;
                    baseSpeed = normalSpeed;
                } else {
                    console.log('Cannot stand up - head collision detected');
                }
            }
            break;
    }
});

// --------------------- Pointer Lock ---------------------
document.addEventListener('click', () => {
    if (activeControls === fpsControls) fpsControls.lock();
});

// --------------------- Camera Mode Switching ---------------------
let activeControls = orbitControls;

function activateOrbitControls() {
    fpsControls.unlock && fpsControls.unlock();
    fpsControls.enabled = false;
    orbitControls.enabled = true;
    activeControls = orbitControls;
    console.log('Orbit Controls Activated');
    if (document.getElementById("cameraView")) {
        document.getElementById("cameraView").value = "orbit";
    }
}

function activateFPSControls() {
    orbitControls.enabled = false;
    fpsControls.enabled = true;
    activeControls = fpsControls;
    camera.position.set(150, -19, 0);
    console.log('FPS Controls Activated');
    if (document.getElementById("cameraView")) {
        document.getElementById("cameraView").value = "fps";
    }
}

window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyO') activateOrbitControls();
    if (e.code === 'KeyP') activateFPSControls();
    
    // Debug key to toggle collision box visibility
    if (e.code === 'KeyB') {
        window.DEBUG_COLLIDERS = !window.DEBUG_COLLIDERS;
        console.log('Debug colliders:', window.DEBUG_COLLIDERS);

        // Remove existing debug boxes
        const debugBoxes = scene.children.filter(child =>
            child.material && child.material.wireframe && 
            (child.material.color.getHex() === 0xff0000 || child.material.color.getHex() === 0x00ff00)
        );
        debugBoxes.forEach(box => scene.remove(box));

        // Re-create debug boxes if enabled
        if (window.DEBUG_COLLIDERS && colliderBoxes.length > 0) {
            console.log('Creating debug visualization for collision boxes...');
            colliderBoxes.forEach((box, index) => {
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());

                const boxGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
                const boxMaterial = new THREE.MeshBasicMaterial({
                    color: 0xff0000,
                    wireframe: true,
                    transparent: true,
                    opacity: 0.5
                });
                const debugBox = new THREE.Mesh(boxGeometry, boxMaterial);
                debugBox.position.copy(center);
                scene.add(debugBox);

                console.log(`Debug box ${index}: center at ${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}`);
            });
        }
    }
    
    // Debug collision logging
    if (e.code === 'KeyL') {
        window.DEBUG_COLLISION_LOG = !window.DEBUG_COLLISION_LOG;
        console.log('Collision logging:', window.DEBUG_COLLISION_LOG);
    }
    
    // Show current player position
    if (e.code === 'KeyI') {
        console.log(`Player position: ${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)}`);
        console.log(`Ground height: ${groundHeight}`);
        console.log(`Total collision boxes: ${colliderBoxes.length}`);
        
        // Show collision box heights relative to ground
        if (colliderBoxes.length > 0) {
            console.log('Collision box heights relative to ground:');
            colliderBoxes.slice(0, 5).forEach((box, index) => {
                const center = box.getCenter(new THREE.Vector3());
                const minHeight = box.min.y - groundHeight;
                const maxHeight = box.max.y - groundHeight;
                console.log(`  Box ${index}: min=${minHeight.toFixed(2)}, max=${maxHeight.toFixed(2)}, center=${(center.y - groundHeight).toFixed(2)} (relative to ground)`);
            });
        }
    }
    
    // Adjust collision boxes up/down for debugging
    if (e.code === 'ArrowUp') {
        adjustCollisionBoxHeight(1);
        console.log('Moved collision boxes up by 1 unit');
    }
    if (e.code === 'ArrowDown') {
        adjustCollisionBoxHeight(-1);
        console.log('Moved collision boxes down by 1 unit');
    }
    
    // Fine adjustment
    if (e.code === 'PageUp') {
        adjustCollisionBoxHeight(0.1);
        console.log('Moved collision boxes up by 0.1 unit');
    }
    if (e.code === 'PageDown') {
        adjustCollisionBoxHeight(-0.1);
        console.log('Moved collision boxes down by 0.1 unit');
    }
});

if (document.getElementById("cameraView")) {
    document.getElementById("cameraView").addEventListener("change", (e) => {
        if (e.target.value === "orbit") activateOrbitControls();
        if (e.target.value === "fps") activateFPSControls();
    });
}

// --------------------- GLTF Loader with Enhanced Collision Detection ---------------------
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

        // Wait a frame for transformations to apply, then create collision boxes
        requestAnimationFrame(() => {
            console.log('Creating collision boxes...');
            
            // Enhanced collision detection setup
            gltf.scene.traverse((child) => {
                if (child.isMesh) {
                    console.log(`Processing mesh: ${child.name}, position: (${child.position.x.toFixed(2)}, ${child.position.y.toFixed(2)}, ${child.position.z.toFixed(2)})`);
                    
                    // Method 1: Objects with "COLLIDER" in name
                    if (child.name && child.name.includes("COLLIDER")) {
                        collidableObjects.push(child);
                        child.visible = false; // Hide collision meshes
                        createCollisionBoxesFromMesh(child);
                    }
                    // Method 2: Roof-specific collision detection
                    else if (child.name && (
                        child.name.toLowerCase().includes("roof") ||
                        child.name.toLowerCase().includes("ceiling") ||
                        child.name.toLowerCase().includes("top")
                    )) {
                        collidableObjects.push(child);
                        createCollisionBoxesFromMesh(child);
                        console.log(`Added roof collision for: ${child.name}`);
                    }
                    // Method 3: All building meshes
                    else if (child.name && (
                        child.name.includes("building") ||
                        child.name.includes("wall") ||
                        child.name.includes("floor") ||
                        child.name.includes("structure") ||
                        child.name.toLowerCase().includes("collide")
                    )) {
                        collidableObjects.push(child);
                        createCollisionBoxesFromMesh(child);
                    }
                    // Method 4: Auto-detect large static meshes
                    else if (child.geometry && child.material) {
                        const meshBox = new THREE.Box3().setFromObject(child);
                        const size = meshBox.getSize(new THREE.Vector3());

                        // If object is large enough, treat as collidable
                        if (size.x > 2 || size.y > 2 || size.z > 2) {
                            collidableObjects.push(child);
                            createCollisionBoxesFromMesh(child);
                        }
                    }
                }
            });

            console.log(`Created ${colliderBoxes.length} collision boxes`);
            
            // Debug: Print collision box info
            console.log('Collision box analysis:');
            colliderBoxes.forEach((box, index) => {
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                console.log(`Box ${index}: center(${center.x.toFixed(1)}, ${center.y.toFixed(1)}, ${center.z.toFixed(1)}) size(${size.x.toFixed(1)}, ${size.y.toFixed(1)}, ${size.z.toFixed(1)})`);
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

// --------------------- FIXED Animation Loop with Proper Vertical Collision ---------------------
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
        const moveDistance = currentSpeed * delta;

        // Calculate desired movement in world coordinates
        const forward = new THREE.Vector3();
        const right = new THREE.Vector3();

        camera.getWorldDirection(forward);
        forward.y = 0; // Keep movement horizontal
        forward.normalize();

        right.crossVectors(forward, new THREE.Vector3(0, 1, 0));
        right.normalize();

        // Calculate desired position
        const currentPos = camera.position.clone();
        const desiredPos = currentPos.clone();

        desiredPos.add(forward.clone().multiplyScalar(-direction.z * moveDistance));
        desiredPos.add(right.clone().multiplyScalar(direction.x * moveDistance));

        // Apply collision-aware horizontal movement
        const validPos = getValidMovement(currentPos, desiredPos);
        camera.position.copy(validPos);

        // FIXED: Enhanced gravity and vertical collision
        const prevY = camera.position.y;
        verticalVelocity += gravity * delta;
        
        // Calculate next vertical position
        const nextY = camera.position.y + verticalVelocity * delta;
        const nextPos = new THREE.Vector3(camera.position.x, nextY, camera.position.z);

        // Check vertical collision based on movement direction
        if (verticalVelocity > 0) {
            // Moving up (jumping) - check head collision
            const headCheck = checkVerticalCollision(nextPos, 'up');
            if (headCheck.collision) {
                // Hit ceiling/roof - stop upward movement
                verticalVelocity = 0;
                const roofBottom = headCheck.box.min.y;
                camera.position.y = roofBottom - cameraBoxSize.y + 0.1; // Position just below roof
                console.log('Head hit roof at Y:', roofBottom);
            } else {
                camera.position.y = nextY;
            }
        } else {
            // Moving down (falling) - check ground collision
            const groundCheck = checkVerticalCollision(nextPos, 'down');
            if (groundCheck.collision) {
                // Hit ground/floor
                verticalVelocity = 0;
                canJump = true;
                const floorTop = groundCheck.box.max.y;
                camera.position.y = floorTop;
                if (!move.forward && !move.backward && !move.left && !move.right) {
                    bunnyHopMultiplier = 1;
                }
            } else {
                camera.position.y = nextY;
            }
        }

        // Fallback ground collision (original system as backup)
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

// --------------------- Helper Functions for Manual Collision Setup ---------------------

// Function to manually add collision boxes (call this from console)
window.addCollisionBox = function (x, y, z, width, height, depth) {
    const box = new THREE.Box3(
        new THREE.Vector3(x - width / 2, y - height / 2, z - depth / 2),
        new THREE.Vector3(x + width / 2, y + height / 2, z + depth / 2)
    );
    colliderBoxes.push(box);
    console.log(`Added manual collision box at (${x}, ${y}, ${z})`);

    // Create debug visualization
    if (window.DEBUG_COLLIDERS) {
        const boxGeometry = new THREE.BoxGeometry(width, height, depth);
        const boxMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            wireframe: true,
            transparent: true,
            opacity: 0.5
        });
        const debugBox = new THREE.Mesh(boxGeometry, boxMaterial);
        debugBox.position.set(x, y, z);
        scene.add(debugBox);
    }
};

// Function to clear all collision boxes
window.clearCollisionBoxes = function () {
    colliderBoxes.length = 0;
    console.log('All collision boxes cleared');
    
    // Remove debug visualizations
    const debugBoxes = scene.children.filter(child =>
        child.material && child.material.wireframe && 
        (child.material.color.getHex() === 0xff0000 || child.material.color.getHex() === 0x00ff00)
    );
    debugBoxes.forEach(box => scene.remove(box));
};

// Add helper functions to window for debugging
window.adjustCollisionHeight = adjustCollisionBoxHeight;
window.testHeadCollision = function() {
    const headCheck = checkHeadCollision(camera.position);
    console.log('Head collision test:', headCheck.collision);
    if (headCheck.collision) {
        const center = headCheck.box.getCenter(new THREE.Vector3());
        console.log('Colliding with box at:', center);
    }
};

// Add function to manually test roof collision
window.testRoofJump = function() {
    console.log('Testing roof collision...');
    verticalVelocity = 10; // Strong jump
    canJump = false;
};