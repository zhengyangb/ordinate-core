import { describe, expect, it, vi } from 'vitest';
import { DocumentState, resolveDocumentPresentation } from '../src/index';

describe('shared presentation evaluation', () => {
  it('projects a supplied evaluation without recalculating the workbook', () => {
    const document = DocumentState.fromText('# Input\n| 21 {:.2f} |\n\n# Result\n| = @["Input"::A1] * 2 {:.2f} |');
    const evaluation = document.evaluate();
    const evaluate = vi.spyOn(document, 'evaluate');
    const presentation = resolveDocumentPresentation(document, evaluation);
    expect(evaluate).not.toHaveBeenCalled();
    expect(presentation.sheets[1].cells[0][0].displayText).toBe('42.00');
    expect(presentation).toEqual(resolveDocumentPresentation(document));
    expect(evaluate).toHaveBeenCalledOnce();
  });
});
