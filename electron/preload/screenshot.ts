import { ipcRenderer } from "electron"
import { PROCESSING_EVENTS } from "./constants"

export function screenshotChannels() {
  return {
    updateContentDimensions: (dimensions: { width: number; height: number }) =>
      ipcRenderer.invoke("update-content-dimensions", dimensions),
    getRecognitionLanguages: () => ipcRenderer.invoke("get-recognition-languages"),
    takeScreenshot: () => ipcRenderer.invoke("take-screenshot"),
    takeSelectiveScreenshot: () => ipcRenderer.invoke("take-selective-screenshot"),
    getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
    deleteScreenshot: (path: string) =>
      ipcRenderer.invoke("delete-screenshot", path),

    // Event listeners
    onScreenshotTaken: (
      callback: (data: { path: string; preview: string }) => void
    ) => {
      const subscription = (_: any, data: { path: string; preview: string }) =>
        callback(data)
      ipcRenderer.on("screenshot-taken", subscription)
      return () => {
        ipcRenderer.removeListener("screenshot-taken", subscription)
      }
    },
    onScreenshotAttached: (
      callback: (data: { path: string; preview: string }) => void
    ) => {
      const subscription = (_: any, data: { path: string; preview: string }) =>
        callback(data)
      ipcRenderer.on("screenshot-attached", subscription)
      return () => {
        ipcRenderer.removeListener("screenshot-attached", subscription)
      }
    },
    onCaptureAndProcess: (
      callback: (data: { path: string; preview: string }) => void
    ) => {
      const subscription = (_: any, data: { path: string; preview: string }) =>
        callback(data)
      ipcRenderer.on("capture-and-process", subscription)
      return () => {
        ipcRenderer.removeListener("capture-and-process", subscription)
      }
    },
    onSolutionsReady: (callback: (solutions: string) => void) => {
      const subscription = (_: any, solutions: string) => callback(solutions)
      ipcRenderer.on("solutions-ready", subscription)
      return () => {
        ipcRenderer.removeListener("solutions-ready", subscription)
      }
    },
    onResetView: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on("reset-view", subscription)
      return () => {
        ipcRenderer.removeListener("reset-view", subscription)
      }
    },
    onSolutionStart: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on(PROCESSING_EVENTS.INITIAL_START, subscription)
      return () => {
        ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_START, subscription)
      }
    },
    onDebugStart: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on(PROCESSING_EVENTS.DEBUG_START, subscription)
      return () => {
        ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_START, subscription)
      }
    },

    onDebugSuccess: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on("debug-success", subscription)
      return () => {
        ipcRenderer.removeListener("debug-success", subscription)
      }
    },
    onDebugError: (callback: (error: string) => void) => {
      const subscription = (_: any, error: string) => callback(error)
      ipcRenderer.on(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
      return () => {
        ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
      }
    },
    onSolutionError: (callback: (error: string) => void) => {
      const subscription = (_: any, error: string) => callback(error)
      ipcRenderer.on(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription)
      return () => {
        ipcRenderer.removeListener(
          PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          subscription
        )
      }
    },
    onProcessingNoScreenshots: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
      return () => {
        ipcRenderer.removeListener(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
      }
    },

    onProblemExtracted: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription)
      return () => {
        ipcRenderer.removeListener(
          PROCESSING_EVENTS.PROBLEM_EXTRACTED,
          subscription
        )
      }
    },
    onSolutionSuccess: (callback: (data: any) => void) => {
      const subscription = (_: any, data: any) => callback(data)
      ipcRenderer.on(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription)
      return () => {
        ipcRenderer.removeListener(
          PROCESSING_EVENTS.SOLUTION_SUCCESS,
          subscription
        )
      }
    },
    onUnauthorized: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
      return () => {
        ipcRenderer.removeListener(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
      }
    },
  }
}
