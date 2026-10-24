import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

// Small three.js viewer for sw-tools preview meshes. Renders on demand (no animation loop).
// The game is left-handed, three.js is right-handed, so the model is mirrored in X.
export function createViewer(container) {
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) {
        container.textContent = 'WebGL is not available, so the preview cannot be shown.';
        return null;
    }
    // Vertex colors are sRGB bytes; showing them as-is keeps paint looking like the picture.
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.screenSpacePanning = true;

    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const headlight = new THREE.DirectionalLight(0xffffff, 2.2);
    scene.add(headlight, headlight.target);

    const group = new THREE.Group();
    group.scale.x = -1;
    scene.add(group);

    let mesh = null;
    const render = () => {
        headlight.position.copy(camera.position);
        headlight.target.position.copy(controls.target);
        renderer.render(scene, camera);
    };
    controls.addEventListener('change', render);

    const resize = () => {
        const w = container.clientWidth, h = container.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        render();
    };
    new ResizeObserver(resize).observe(container);

    function clear() {
        if (!mesh) return;
        group.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        mesh = null;
    }

    // p: the wasm Preview object. Arrays are copied out of wasm once here.
    // side: +1 views from +Z (glTF fronts), -1 from -Z (how a flat picture reads left to right).
    function setMesh(p, side = 1) {
        clear();
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(p.colors, 3, true));
        geo.setIndex(new THREE.BufferAttribute(p.indices, 1));
        mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
        group.add(mesh);

        const b = p.bounds;
        if (b.length === 6) {
            const box = new THREE.Box3(new THREE.Vector3(-b[3], b[1], b[2]), new THREE.Vector3(-b[0], b[4], b[5]));
            const center = box.getCenter(new THREE.Vector3());
            const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.1);
            const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1;
            camera.near = dist / 1000;
            camera.far = dist * 10;
            camera.position.copy(center).addScaledVector(new THREE.Vector3(0.6 * side, 0.45, side).normalize(), dist);
            camera.updateProjectionMatrix();
            controls.target.copy(center);
            controls.update();
        }
        resize();
        render();
    }

    return { setMesh, clear, resize, el: container };
}
