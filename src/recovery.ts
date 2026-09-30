export type ExecutionFeedback = {
  intent: string;
  action: string;
  result: 'success' | 'failed' | 'unknown';
  nextStep: string;
};

export function feedback(intent: string, action: string, result: ExecutionFeedback['result'], nextStep: string): ExecutionFeedback {
  return { intent, action, result, nextStep };
}
