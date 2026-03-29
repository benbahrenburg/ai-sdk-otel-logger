declare module '@vercel/otel' {
  export interface RegisterOTelOptions {
    serviceName?: string;
  }

  export function registerOTel(options?: RegisterOTelOptions): void;
}
