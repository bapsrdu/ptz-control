import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Booth Video's window: booth/frontend, built into dist-booth/, which
// booth/main.js loads from disk. It shares the video, joystick, zoom lever
// and person detector with Universal PTZ Controller (frontend/src).
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const POSE_FILES = [
    'pose.js', 'pose_web.binarypb', 'pose_solution_packed_assets_loader.js', 'pose_solution_packed_assets.data',
    'pose_solution_simd_wasm_bin.js', 'pose_solution_simd_wasm_bin.wasm', 'pose_solution_simd_wasm_bin.data',
    'pose_solution_wasm_bin.js', 'pose_solution_wasm_bin.wasm', 'pose_landmark_lite.tflite', 'pose_landmark_full.tflite',
];

function copyPose() {
    return {
        name: 'copy-mediapipe-pose',
        closeBundle() {
            const from = path.join(root, 'node_modules/@mediapipe/pose');
            const to = path.join(root, 'dist-booth/mediapipe');
            fs.mkdirSync(to, { recursive: true });
            for (const f of POSE_FILES) fs.copyFileSync(path.join(from, f), path.join(to, f));
        },
    };
}

export default defineConfig({
    root: path.join(here, 'frontend'),
    base: './',
    plugins: [react(), tailwindcss(), copyPose()],
    build: { outDir: path.join(root, 'dist-booth'), emptyOutDir: true },
    server: { fs: { allow: [root] } },
});
