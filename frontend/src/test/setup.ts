import '@testing-library/jest-dom/vitest';

class ResizeObserverMock {
  disconnect() {}
  observe() {}
  unobserve() {}
}

globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverMock;
