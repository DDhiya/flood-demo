export type FloodAction =
  | { type: 'SET_RAIN_LEVEL'; value: number }                 // 0..100
  | { type: 'TRIGGER_STATE'; state: 'NORMAL' | 'RAIN' }        // switch videos
  | { type: 'SCRIPT'; name: 'PM_MODE' | 'STOP' };              // optional scripted demo
