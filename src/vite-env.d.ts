/// <reference types="vite/client" />
import { ElectronAPI } from './types/electron';

interface Window {
    electronAPI: ElectronAPI
}
