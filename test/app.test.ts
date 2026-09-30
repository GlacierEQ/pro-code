import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('pro-code App', () => {
  it('exports a React component', async () => {
    const mod = await import('../src/App');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('exports useWorkerDispatch hook', async () => {
    const mod = await import('../src/useWorkerDispatch');
    expect(mod.useWorkerDispatch).toBeDefined();
    expect(typeof mod.useWorkerDispatch).toBe('function');
  });

  it('exports useWorkerHealth hook', async () => {
    const mod = await import('../src/useWorkerHealth');
    expect(mod.useWorkerHealth).toBeDefined();
    expect(typeof mod.useWorkerHealth).toBe('function');
  });

  it('exports memory module', async () => {
    const mod = await import('../src/memory');
    expect(mod).toBeDefined();
  });

  it('exports workers module', async () => {
    const mod = await import('../src/workers');
    expect(mod).toBeDefined();
  });

  it('exports Loader component', async () => {
    const mod = await import('../src/Loader');
    expect(mod.Loader).toBeDefined();
    expect(typeof mod.Loader).toBe('function');
  });
});
