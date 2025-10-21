// Gran Canaria 3D Terrain Map
// Using Three.js and WebGL

let scene, camera, renderer, terrain, controls;
let terrainSize = 100;
let heightScale = 20;

// Initialize the 3D scene
function init() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky blue
    scene.fog = new THREE.Fog(0x87CEEB, 50, 200);

    // Create camera
    camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    camera.position.set(0, 50, 80);
    camera.lookAt(0, 0, 0);

    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('container').appendChild(renderer.domElement);

    // Add orbit controls for interaction
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 20;
    controls.maxDistance = 200;
    controls.maxPolarAngle = Math.PI / 2;

    // Add lights
    addLights();

    // Create terrain
    createTerrain();

    // Add water plane around the island
    createWater();

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Start animation loop
    animate();
}

// Add lighting to the scene
function addLights() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // Directional light (sun)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 50, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    // Hemisphere light for better color
    const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x654321, 0.3);
    scene.add(hemiLight);
}

// Generate height map data for Gran Canaria
// Gran Canaria is roughly circular with volcanic peaks in the center
function generateHeightMap(width, height) {
    const size = width * height;
    const data = new Float32Array(size);

    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(width, height) * 0.4;

    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            const index = i * width + j;

            // Calculate distance from center
            const dx = j - centerX;
            const dy = i - centerY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Create circular island shape
            const islandFactor = Math.max(0, 1 - (distance / maxRadius));

            // Add volcanic peaks with multiple summits
            const angle = Math.atan2(dy, dx);
            const radialNoise = Math.sin(angle * 8) * 0.15;

            // Main peak (Pico de las Nieves) - slightly off center
            const peak1X = centerX + 5;
            const peak1Y = centerY - 5;
            const dist1 = Math.sqrt((j - peak1X) ** 2 + (i - peak1Y) ** 2);
            const peak1 = Math.exp(-dist1 / 15) * 0.8;

            // Secondary peak (Roque Nublo area)
            const peak2X = centerX - 8;
            const peak2Y = centerY + 3;
            const dist2 = Math.sqrt((j - peak2X) ** 2 + (i - peak2Y) ** 2);
            const peak2 = Math.exp(-dist2 / 12) * 0.6;

            // Tertiary peak
            const peak3X = centerX + 10;
            const peak3Y = centerY + 8;
            const dist3 = Math.sqrt((j - peak3X) ** 2 + (i - peak3Y) ** 2);
            const peak3 = Math.exp(-dist3 / 10) * 0.5;

            // Add some roughness and valleys
            const roughness = (Math.sin(j * 0.3) * Math.cos(i * 0.3) +
                             Math.sin(j * 0.5 + 50) * Math.cos(i * 0.5 + 50)) * 0.1;

            // Combine all factors
            let height = islandFactor * (peak1 + peak2 + peak3 + radialNoise + roughness);

            // Add coastal lowlands
            if (islandFactor > 0 && islandFactor < 0.3) {
                height *= 0.3;
            }

            // Normalize and scale
            height = Math.max(0, height);
            data[index] = height;
        }
    }

    return data;
}

// Create the 3D terrain mesh
function createTerrain() {
    const resolution = 256; // Resolution of the height map
    const heightData = generateHeightMap(resolution, resolution);

    // Create geometry
    const geometry = new THREE.PlaneGeometry(
        terrainSize,
        terrainSize,
        resolution - 1,
        resolution - 1
    );

    // Apply height map to vertices
    const vertices = geometry.attributes.position.array;
    for (let i = 0; i < vertices.length / 3; i++) {
        vertices[i * 3 + 2] = heightData[i] * heightScale;
    }

    // Compute normals for proper lighting
    geometry.computeVertexNormals();

    // Create material with vertex colors based on height
    const material = new THREE.MeshStandardMaterial({
        vertexColors: false,
        flatShading: false,
        side: THREE.DoubleSide,
        metalness: 0.1,
        roughness: 0.9
    });

    // Add colors based on elevation
    addTerrainColors(geometry, heightData);

    // Create mesh
    terrain = new THREE.Mesh(geometry, material);
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true;
    terrain.castShadow = true;

    scene.add(terrain);
}

// Add realistic terrain colors based on elevation
function addTerrainColors(geometry, heightData) {
    const colors = [];
    const color = new THREE.Color();

    for (let i = 0; i < heightData.length; i++) {
        const height = heightData[i];

        if (height < 0.1) {
            // Beach/coastal - sandy color
            color.setHex(0xd4a574);
        } else if (height < 0.25) {
            // Low elevation - dry vegetation
            color.setHex(0x8b7355);
        } else if (height < 0.4) {
            // Mid elevation - more vegetation
            color.setHex(0x6b8e23);
        } else if (height < 0.6) {
            // Higher elevation - forests
            color.setHex(0x4a7023);
        } else if (height < 0.75) {
            // High peaks - rocky
            color.setHex(0x808080);
        } else {
            // Highest peaks - rocky/volcanic
            color.setHex(0x696969);
        }

        colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.getAttribute('color').needsUpdate = true;

    // Update material to use vertex colors
    if (terrain) {
        terrain.material.vertexColors = true;
        terrain.material.needsUpdate = true;
    }
}

// Create water around the island
function createWater() {
    const waterGeometry = new THREE.PlaneGeometry(terrainSize * 1.5, terrainSize * 1.5);
    const waterMaterial = new THREE.MeshStandardMaterial({
        color: 0x1e90ff,
        transparent: true,
        opacity: 0.7,
        metalness: 0.5,
        roughness: 0.2,
        side: THREE.DoubleSide
    });

    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.5;
    water.receiveShadow = true;

    scene.add(water);
}

// Handle window resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    // Update controls
    controls.update();

    // Render scene
    renderer.render(scene, camera);
}

// Start the application when the page loads
window.addEventListener('load', init);
