import { useEffect, useRef, useState } from 'react';
import { PluginContext } from 'molstar/lib/mol-plugin/context';
import { DefaultPluginSpec, PluginSpec } from 'molstar/lib/mol-plugin/spec';
import { Color } from 'molstar/lib/mol-util/color';
import { MAQualityAssessment } from 'molstar/lib/extensions/model-archive/quality-assessment/behavior';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms';
import { StructureSelectionQueries } from 'molstar/lib/mol-plugin-state/helpers/structure-selection-query';
import { QueryContext, StructureSelection, type Structure } from 'molstar/lib/mol-model/structure';
import { tmAlign } from 'molstar/lib/mol-model/structure/structure/util/tm-align';
import { MolScriptBuilder as MS } from 'molstar/lib/mol-script/language/builder';
import type { StateObjectSelector } from 'molstar/lib/mol-state';
import type { PluginStateObject as SO } from 'molstar/lib/mol-plugin-state/objects';
import type { StructureSource } from '../api/alphafold';

export interface AlignmentInfo {
  tmScore: number;
  rmsd: number;
  alignedLength: number;
}

interface Props {
  source: StructureSource | null;
  /** Optional reference structure, superposed onto `source` with TM-align. */
  reference?: StructureSource | null;
  /** 1-based residue numbers (label_seq_id) in `source` to highlight. */
  highlight?: number[] | null;
  onAligned?: (info: AlignmentInfo | null) => void;
  /** Shown when there is no structure to display. */
  emptyMessage?: string;
}

const COLORS = {
  background: Color(0x0b0f17),
  reference: Color(0x7a8494),
  current: Color(0x5cc8ff),
  changed: Color(0xff8a5c),
};

type StructRef = StateObjectSelector<SO.Molecule.Structure>;

async function loadStructure(plugin: PluginContext, src: StructureSource): Promise<StructRef> {
  const data = await plugin.builders.data.download({ url: src.url, isBinary: src.isBinary }, { state: { isGhost: true } });
  const traj = await plugin.builders.structure.parseTrajectory(data, src.format);
  const model = await plugin.builders.structure.createModel(traj);
  return plugin.builders.structure.createStructure(model);
}

function traceLoci(s: Structure) {
  return StructureSelection.toLociWithSourceUnits(StructureSelectionQueries.trace.query(new QueryContext(s)));
}

const residueSet = (ids: number[]) =>
  MS.core.set.has([MS.set(...ids), MS.ammp('label_seq_id')]);

/**
 * A single long-lived Mol* plugin (canvas only, no Mol* UI). Changing props
 * swaps the loaded structures without remounting WebGL.
 */
export function MolstarView({ source, reference, highlight, onAligned, emptyMessage }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const pluginRef = useRef<PluginContext | null>(null);
  const onAlignedRef = useRef(onAligned);
  onAlignedRef.current = onAligned;
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
        renderer: { backgroundColor: COLORS.background },
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

  const highlightKey = highlight ? highlight.join(',') : '';

  // (Re)build the scene whenever inputs change.
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!ready || !plugin) return;
    let stale = false;
    const ids = highlightKey ? highlightKey.split(',').map(Number) : [];

    (async () => {
      setError(null);
      onAlignedRef.current?.(null);
      await plugin.clear();
      if (!source || stale) return;
      setLoading(true);
      try {
        const cur = await loadStructure(plugin, source);
        if (stale) return;
        const rep = plugin.builders.structure.representation;

        if (!reference) {
          // Single protein: colour by per-residue confidence (pLDDT).
          await rep.addRepresentation(cur, { type: 'cartoon', color: 'plddt-confidence' as 'uniform' });
        } else {
          const ref = await loadStructure(plugin, reference);
          if (stale) return;

          // Superpose reference onto current by structure (TM-align), which
          // works even when sequences have diverged a lot.
          const res = tmAlign(traceLoci(cur.data!), traceLoci(ref.data!));
          const b = plugin.build().to(ref).apply(StateTransforms.Model.TransformStructureConformation, {
            transform: { name: 'matrix', params: { data: res.bTransform, transpose: false } },
          });
          await b.commit();
          if (stale) return;
          onAlignedRef.current?.({ tmScore: res.tmScoreA, rmsd: res.rmsd, alignedLength: res.alignedLength });

          await rep.addRepresentation(b.selector, {
            type: 'cartoon',
            color: 'uniform',
            colorParams: { value: COLORS.reference },
            typeParams: { alpha: 0.35 },
          });

          // Current protein: blue, with residues changed vs reference in orange.
          const groups = ids.length
            ? [
                { key: 'unchanged', test: MS.core.logic.not([residueSet(ids)]), color: COLORS.current },
                { key: 'changed', test: residueSet(ids), color: COLORS.changed },
              ]
            : [{ key: 'all', test: undefined, color: COLORS.current }];
          for (const g of groups) {
            const expr = MS.struct.generator.atomGroups(g.test ? { 'residue-test': g.test } : {});
            const comp = await plugin.builders.structure.tryCreateComponentFromExpression(cur, expr, g.key);
            if (stale) return;
            if (comp) {
              await rep.addRepresentation(comp, { type: 'cartoon', color: 'uniform', colorParams: { value: g.color } });
            }
          }
        }
        plugin.managers.camera.reset();
      } catch (e) {
        if (!stale) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [ready, source, reference, highlightKey]);

  return (
    <div className="molstar-container" ref={containerRef}>
      <div ref={canvasHostRef} className="molstar-canvas-host" />
      {!source && emptyMessage && <div className="viewer-overlay">{emptyMessage}</div>}
      {loading && <div className="viewer-overlay viewer-overlay--subtle">Loading structure…</div>}
      {error && <div className="viewer-overlay viewer-overlay--error">{error}</div>}
    </div>
  );
}
