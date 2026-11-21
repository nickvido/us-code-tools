import { describe, it, expect } from 'vitest';
import { parseUslmToIr } from '../../../src/transforms/uslm-to-ir';

// Regression: section numbers (read from the non-ordered parse) were paired with headings and content
// (read from the order-preserving parse) by list index. The non-ordered walk visits a container's
// <subchapter>/<part> children before its direct <section> children, so whenever a chapter mixes the two
// every following section got its neighbour's number. Real titles (e.g. 42, 50) were ~1 in 3 affected.
function buildXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0"><main>
<title identifier="/us/usc/t50"><num value="50">Title 50</num><heading>WAR AND NATIONAL DEFENSE</heading>
${body}
</title></main></uscDoc>`;
}

function section(num: string, heading: string, text: string): string {
  return `<section identifier="/us/usc/t50/s${num}"><num value="${num}">§ ${num}.</num><heading>${heading}</heading>`
    + `<content><p>${text}</p></content></section>`;
}

function textOf(value: unknown): string {
  return JSON.stringify(value);
}

describe('section number / body pairing', () => {
  it('keeps each section number with its own heading and content when sections precede subchapters', () => {
    const xml = buildXml(`
<chapter identifier="/us/usc/t50/ch44"><num value="44">CHAPTER 44</num><heading>NATIONAL SECURITY</heading>
  ${section('3001', 'Short title', 'alpha text')}
  <subchapter identifier="/us/usc/t50/ch44/schI"><num value="I">SUBCHAPTER I</num><heading>COORDINATION</heading>
    ${section('3002', 'Congressional declaration of purpose', 'bravo text')}
    ${section('3003', 'Definitions', 'charlie text')}
  </subchapter>
  ${section('3004', 'Trailing section', 'delta text')}
  <part identifier="/us/usc/t50/ch44/ptA"><num value="A">PART A</num><heading>MISC</heading>
    ${section('3005', 'Part section', 'echo text')}
  </part>
</chapter>`);

    const { titleIr, parseErrors } = parseUslmToIr(xml);
    expect(parseErrors).toEqual([]);

    const byNumber = new Map(titleIr.sections.map((s) => [s.sectionNumber, s]));
    const expected: Array<[string, string, string]> = [
      ['3001', 'Short title', 'alpha text'],
      ['3002', 'Congressional declaration of purpose', 'bravo text'],
      ['3003', 'Definitions', 'charlie text'],
      ['3004', 'Trailing section', 'delta text'],
      ['3005', 'Part section', 'echo text'],
    ];
    expect(titleIr.sections).toHaveLength(expected.length);
    for (const [num, heading, text] of expected) {
      const parsed = byNumber.get(num);
      expect(parsed?.heading).toBe(heading);
      expect(parsed?.identifier).toBe(`/us/usc/t50/s${num}`);
      expect(textOf(parsed?.content)).toContain(text);
      for (const [, , other] of expected.filter(([n]) => n !== num)) {
        expect(textOf(parsed?.content)).not.toContain(other);
      }
    }
  });

  it('does not leak the internal sequence marker into parsed output', () => {
    const xml = buildXml(`
<chapter identifier="/us/usc/t50/ch44"><num value="44">CHAPTER 44</num><heading>NATIONAL SECURITY</heading>
  ${section('3001', 'Short title', 'alpha text')}
</chapter>`);
    const { titleIr } = parseUslmToIr(xml);
    expect(JSON.stringify(titleIr)).not.toContain('section-seq');
  });
});
