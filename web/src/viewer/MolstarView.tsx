import { useEffect, useRef, useState } from 'react';
import { PluginContext } from 'molstar/lib/mol-plugin/context';
import { DefaultPluginSpec, PluginSpec } from 'molstar/lib/mol-plugin/spec';
import { Color } from 'molstar/lib/mol-util/color';
import {
  MAQualityAssessment,
  QualityAssessmentPLDDTPreset,
} from 'molstar/lib/extensions/model-archive/quality-assessment/behavior';
import type { StructureSource } from '../api/alphafold';

interface Props {
  source: StructureSource | null;
  /** Shown when there is no structure to display. */
  emptyMessage?: string;
}

/**
 * A single long-lived Mol* plugin (canvas only, no Mol* UI). Changing
 * `source` swaps the loaded structure without remounting WebGL.
 */
export function MolstarView({ source, emptyMessage }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const pluginRef = useRef<PluginContext | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create the plugin once.
  useEffect(() => {
    let disposed = false;
    const base = DefaultPluginSpec();
    const plugin = new PluginContext({
      ...base,
      behaviors: [...base.behaviors, PluginSpec.Behavior(MAQualityAssessment)],
    });
    // Each plugin instance gets its own canvas: a WebGL context released by a
    // disposed plugin (e.g. React StrictMode's double mount) can't be reused.
    const canvas = document.createElement('canvas');
    canvas.className = 'molstar-canvas';
    canvasHostRef.current!.appendChild(canvas);
    (async () => {
      await plugin.init();
      if (disposed) return;
      const ok = await plugin.initViewerAsync(canvas, containerRef.current!);
      if (disposed) return;
      if (!ok) {
        setError('WebGL is not available in this browser');
        return;
      }
      plugin.canvas3d?.setProps({
        renderer: { backgroundColor: Color(0x0b0f17) },
        trackball: { animate: { name: 'off', params: {} } },
      });
      pluginRef.current = plugin;
      setReady(true);
    })();
    return () => {
      disposed = true;
      plugin.dispose();
      canvas.remove();
      pluginRef.current = null;
      setReady(false);
    };
  }, []);

  // Load whenever the source changes.
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!ready || !plugin) return;
    let stale = false;
    (async () => {
      setError(null);
      await plugin.clear();
      if (!source) return;
      setLoading(true);
      try {
        const data = await plugin.builders.data.download(
          { url: source.url, isBinary: source.isBinary },
          { state: { isGhost: true } },
        );
        if (stale) return;
        const traj = await plugin.builders.structure.parseTrajectory(data, source.format);
        if (stale) return;
        await plugin.builders.structure.hierarchy.applyPreset(traj, 'default', {
          showUnitcell: false,
          // Colour predicted models by per-residue confidence (pLDDT).
          // (Mol* types this as built-in preset names only; extension presets
          // registered by MAQualityAssessment are valid at runtime.)
          representationPreset: QualityAssessmentPLDDTPreset.id as 'auto',
        });
      } catch (e) {
        if (!stale) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [ready, source]);

  return (
    <div className="molstar-container" ref={containerRef}>
      <div ref={canvasHostRef} className="molstar-canvas-host" />
      {!source && emptyMessage && <div className="viewer-overlay">{emptyMessage}</div>}
      {loading && <div className="viewer-overlay viewer-overlay--subtle">Loading structure…</div>}
      {error && <div className="viewer-overlay viewer-overlay--error">{error}</div>}
    </div>
  );
}
