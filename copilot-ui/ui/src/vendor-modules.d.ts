declare module 'dompurify' {
  interface DOMPurifyInstance {
    sanitize(dirty: string, config?: Record<string, unknown>): string;
  }

  const DOMPurify: DOMPurifyInstance;
  export default DOMPurify;
}

declare module 'mermaid' {
  type MermaidSecurityLevel = 'strict' | 'loose' | 'antiscript' | 'sandbox';

  interface MermaidConfig {
    startOnLoad?: boolean;
    securityLevel?: MermaidSecurityLevel;
    theme?: string;
    [key: string]: unknown;
  }

  interface MermaidRenderResult {
    svg: string;
    bindFunctions?: (element: Element) => void;
  }

  interface MermaidApi {
    initialize(config: MermaidConfig): void;
    render(id: string, text: string): Promise<MermaidRenderResult>;
  }

  const mermaid: MermaidApi;
  export default mermaid;
}
