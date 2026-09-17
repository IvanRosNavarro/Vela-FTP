import { useState } from 'react';
import type { DialogSpec } from '../../stores/dialogStore';
import { Modal } from './Modal';

type Confirm = Extract<DialogSpec, { kind: 'confirm' }>;
type Prompt = Extract<DialogSpec, { kind: 'prompt' }>;

export function ConfirmDialog({ spec, onClose }: { spec: Confirm; onClose: () => void }) {
  const finish = (ok: boolean) => {
    spec.resolve(ok);
    onClose();
  };
  return (
    <Modal
      title={spec.title}
      onClose={() => finish(false)}
      footer={
        <>
          <button className="vf-btn" onClick={() => finish(false)}>
            Cancelar
          </button>
          <button className={spec.danger ? 'vf-btn-danger' : 'vf-btn-primary'} onClick={() => finish(true)}>
            {spec.confirmLabel}
          </button>
        </>
      }
    >
      <p className="whitespace-pre-line leading-relaxed">{spec.message}</p>
    </Modal>
  );
}

export function PromptDialog({ spec, onClose }: { spec: Prompt; onClose: () => void }) {
  const [value, setValue] = useState(spec.initial);
  const error = spec.validate(value);
  const finish = (result: string | null) => {
    spec.resolve(result);
    onClose();
  };
  return (
    <Modal
      title={spec.title}
      onClose={() => finish(null)}
      footer={
        <>
          <button className="vf-btn" onClick={() => finish(null)}>
            Cancelar
          </button>
          <button className="vf-btn-primary" disabled={error !== null} onClick={() => finish(value)}>
            {spec.confirmLabel}
          </button>
        </>
      }
    >
      <label className="vf-label">
        {spec.label}
        <input
          className="vf-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => {
            // Seleccionar el nombre sin la extensión, como los exploradores.
            const dot = e.target.value.lastIndexOf('.');
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && error === null) finish(value);
          }}
        />
      </label>
      {error && value !== spec.initial && <p className="mt-2 text-[var(--vela-danger)]">{error}</p>}
    </Modal>
  );
}
