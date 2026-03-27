import { ipcRenderer } from "electron"

export function meetingChannels() {
  return {
    startMeeting: (metadata?: any) => ipcRenderer.invoke("start-meeting", metadata),
    endMeeting: () => ipcRenderer.invoke("end-meeting"),
    getRecentMeetings: () => ipcRenderer.invoke("get-recent-meetings"),
    getMeetingDetails: (id: string) => ipcRenderer.invoke("get-meeting-details", id),
    updateMeetingTitle: (id: string, title: string) => ipcRenderer.invoke("update-meeting-title", { id, title }),
    updateMeetingSummary: (id: string, updates: any) => ipcRenderer.invoke("update-meeting-summary", { id, updates }),
    deleteMeeting: (id: string) => ipcRenderer.invoke("delete-meeting", id),
    onMeetingsUpdated: (callback: () => void) => {
      const subscription = () => callback()
      ipcRenderer.on("meetings-updated", subscription)
      return () => {
        ipcRenderer.removeListener("meetings-updated", subscription)
      }
    },
  }
}
