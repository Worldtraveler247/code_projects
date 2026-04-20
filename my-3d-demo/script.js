import * as THREE from 'three';

// 1. Create the Scene (The World)
const scene = new THREE.Scene();

// 2. Create the Camera (The Eye)
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

// 3. Create the Renderer (The Painter)
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 4. Create a 3D Shape (Geometry + Material = Mesh)
const geometry = new THREE.BoxGeometry(2, 2, 2);
const material = new THREE.MeshStandardMaterial({ 
    color: 0x00ff88,
    metalness: 0.7,
    roughness: 0.2
});
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// 5. Add Lighting (This makes it look 3D!)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); // Soft overall light
scene.add(ambientLight);

const pointLight = new THREE.PointLight(0xffffff, 50); // Bright spot light
pointLight.position.set(5, 5, 5);
scene.add(pointLight);

// 6. Animation Loop (Runs 60 times per second)
function animate() {
    requestAnimationFrame(animate);

    // Rotate the cube on X and Y axis
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;

    // Pulse the size slightly
    const scale = 1 + Math.sin(Date.now() * 0.002) * 0.1;
    cube.scale.set(scale, scale, scale);

    renderer.render(scene, camera);
}

// Handle window resizing
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();