import type { SetStateAction } from 'react';

/** The two flags of one answer request: it is running, and what was asked can be asked again. */
export interface MeetingChatFlagsState {
  isProcessing: boolean;
  canRetry: boolean;
}

export const initialMeetingChatFlags: MeetingChatFlagsState = {
  isProcessing: false,
  canRetry: false,
};

export type MeetingChatFlagsAction =
  | { type: 'processingChanged'; value: SetStateAction<boolean> }
  | { type: 'retryChanged'; canRetry: boolean };

export function meetingChatFlagsReducer(
  state: MeetingChatFlagsState,
  action: MeetingChatFlagsAction
): MeetingChatFlagsState {
  switch (action.type) {
    case 'processingChanged': {
      const { value } = action;
      const isProcessing = typeof value === 'function' ? value(state.isProcessing) : value;
      return isProcessing === state.isProcessing ? state : { ...state, isProcessing };
    }
    case 'retryChanged':
      return action.canRetry === state.canRetry ? state : { ...state, canRetry: action.canRetry };
  }
}
