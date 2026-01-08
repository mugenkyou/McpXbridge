import { WebSocket } from "ws";

export interface SocketMessageSender<T> {
  sendSocketMessage<K extends keyof T>(
    type: K,
    payload: T[K],
    options?: { timeoutMs?: number }
  ): Promise<any>;
}

export function createSocketMessageSender<T>(
  ws: WebSocket
): SocketMessageSender<T> {
  return {
    async sendSocketMessage<K extends keyof T>(
      type: K,
      payload: T[K],
      options: { timeoutMs?: number } = { timeoutMs: 30000 }
    ): Promise<any> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Request timeout"));
        }, options.timeoutMs);

        const messageId = Math.random().toString(36).substr(2, 9);
        
        const message = {
          id: messageId,
          type,
          payload,
        };

        const handleMessage = (data: any) => {
          try {
            const raw = data.toString();
            console.error(`[Sender] Raw received: ${raw}`);
            const response = JSON.parse(raw);
            if (response.id === messageId) {
              console.error(`[Sender] Matched ID: ${messageId}`);
              clearTimeout(timeout);
              ws.off('message', handleMessage);
              if (response.error) {
                reject(new Error(response.error));
              } else {
                resolve(response.result);
              }
            } else {
               console.error(`[Sender] Ignored message with ID: ${response.id}, expected: ${messageId}`);
            }
          } catch (e) {
            console.error(`[Sender] Parse error: ${e}`, data.toString());
          }
        };

        ws.on('message', handleMessage);
        console.error(`[Sender] Sending message: ${JSON.stringify(message)}`);
        ws.send(JSON.stringify(message));
      });
    },
  };
}


