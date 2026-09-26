import { describe, expect, it } from 'vitest';
import { buildPreview, deriveKeyPoints, parseCsv, rowsToObjects, toCsv } from '../../src/app/core/logic/importer';
import { hashText } from '../../src/app/core/util';

describe('importer', () => {
  it('parses CSV with quotes, commas and newlines', () => {
    const rows = parseCsv('question,category,answer\n"What is DI, really?",.NET,"Line1\nLine2 ""quoted"""\n');
    expect(rows[1][0]).toBe('What is DI, really?');
    expect(rows[1][2]).toBe('Line1\nLine2 "quoted"');
  });
  it('validates, flags duplicates in file and against existing, never imports errors', () => {
    const raw = rowsToObjects(parseCsv([
      'Question,Category,Topic,Difficulty,Answer,Tags',
      'What is dependency injection?,.NET,DI,Medium,Supplying deps,"di, ioc"',
      'What is dependency injection?,.NET,DI,Medium,dup,',
      'What is a closure in JavaScript?,Angular,JS,expert,x,',
      ',.NET,DI,Easy,no question,',
      'Explain CQRS with an example,Architecture,,Senior,,',
    ].join('\n')));
    const existing = [{ id: 'e1', question: 'Explain CQRS with an example', hash: hashText('Explain CQRS with an example'), categoryId: 'cat-arch' }];
    const p = buildPreview(raw, existing, [{ id: 'cat-arch', name: 'Architecture' }], [], 'skip');
    expect(p.counts.total).toBe(5);
    expect(p.counts.errors).toBe(1);
    expect(p.rows[1].status).toBe('duplicate-in-file');
    expect(p.rows[4].status).toBe('duplicate-existing');
    expect(p.rows[2].difficulty).toBe('Senior'); // "expert" mapped
    expect(p.rows[0].tags).toEqual(['di', 'ioc']);
    expect(p.counts.new).toBe(2);
    expect(p.newCategories.sort()).toEqual(['.NET', 'Angular']);
    const upd = buildPreview(raw, existing, [{ id: 'cat-arch', name: 'Architecture' }], [], 'update');
    expect(upd.rows[4].status).toBe('update');
    expect(upd.rows[4].existingId).toBe('e1');
  });
  it('accepts the existing bank format (core/tier) and derives key points from bullets', () => {
    const p = buildPreview([{ id: 'c01', category: '.NET', topic: 'OOPS', difficulty: 'Senior', question: 'What are the four pillars of OOP?', answer: 'One line.\n• Encapsulation – keep data private\n• Abstraction – hide the how', core: true, tier: 1 }], [], [], []);
    expect(p.rows[0].priority).toBe(1);
    expect(p.rows[0].keyPoints).toEqual(['Encapsulation', 'Abstraction']);
    expect(deriveKeyPoints('no bullets')).toEqual([]);
  });
  it('round-trips CSV export', () => {
    const csv = toCsv([{ a: 'x,y', b: ['p', 'q'] }]);
    expect(parseCsv(csv)[1]).toEqual(['x,y', 'p | q']);
  });
});
