import { useState, type FormEvent } from 'react';

const EXAMPLES = ['HBB', 'MB', 'RHO', 'CYCS', 'LYZ', 'INS'];

export function SearchBar({ onSearch, busy }: { onSearch: (symbol: string) => void; busy: boolean }) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = value.trim();
    if (s) onSearch(s);
  };
  return (
    <form className="search" onSubmit={submit}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Human gene symbol, e.g. HBB"
        aria-label="Gene symbol"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
      />
      <button type="submit" disabled={busy}>
        {busy ? '…' : 'Go'}
      </button>
      <div className="search-examples">
        {EXAMPLES.map((ex) => (
          <button
            type="button"
            key={ex}
            onClick={() => {
              setValue(ex);
              onSearch(ex);
            }}
          >
            {ex}
          </button>
        ))}
      </div>
    </form>
  );
}
