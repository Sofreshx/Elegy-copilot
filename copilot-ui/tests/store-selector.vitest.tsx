import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createStore, useStoreSelector } from '../ui/src/lib/store';

describe('useStoreSelector', () => {
  it('does not rerender when an unrelated store field changes', () => {
    const store = createStore({ selected: 1, unrelated: 0 });
    let renders = 0;

    function Probe() {
      renders += 1;
      const selected = useStoreSelector(store, (state) => state.selected);
      return <span>{selected}</span>;
    }

    render(<Probe />);
    expect(renders).toBe(1);

    act(() => store.setState((state) => ({ ...state, unrelated: 1 })));
    expect(renders).toBe(1);

    act(() => store.setState((state) => ({ ...state, selected: 2 })));
    expect(screen.getByText('2')).toBeTruthy();
    expect(renders).toBe(2);
  });
});
