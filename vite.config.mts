import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { version } from './package.json'

// Inject version so the React frontend can read it via import.meta.env.VITE_APP_VERSION
process.env.VITE_APP_VERSION = version;

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    base: './', // Use relative paths for Electron
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 5180,
    },
    build: {
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            output: {
                // Vite 8 (rolldown) only accepts the function form of manualChunks.
                manualChunks(id: string) {
                    if (!id.includes('node_modules')) return undefined
                    if (/[\\/]node_modules[\\/](react|react-dom|framer-motion)[\\/]/.test(id)) return 'vendor'
                    if (/[\\/]node_modules[\\/](lucide-react|@radix-ui[\\/]react-(dialog|toast))[\\/]/.test(id)) return 'ui'
                    return undefined
                }
            }
        }
    }
})
