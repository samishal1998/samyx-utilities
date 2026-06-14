# Layer 2: Codecs

**Status: Planned - Not Yet Implemented**

Layer 2 provides full bidirectional XML ↔ TypeScript transformation using Zod codecs.

## Overview

```
XML String ←→ Layer 2 Codec ←→ Clean TypeScript Types
```

Layer 2 codecs:
- Parse XML strings into clean TypeScript types
- Serialize TypeScript types back to XML strings
- Use Layer 1 for validation internally
- Handle all XML concerns (namespaces, prefixes, declarations)

## Design Goals

### Clean Interfaces

Layer 1 (XML JSON shape):
```typescript
{
  "domain:cd": [{
    "domain:name": {
      "@_avail": "1",
      "#text": "example.com"
    }
  }]
}
```

Layer 2 (clean TypeScript):
```typescript
{
  domains: [{
    name: "example.com",
    available: true
  }]
}
```

### Bidirectional

```typescript
// Decode: XML → TypeScript
const data = DomainChkDataCodec.decode(xmlString);

// Encode: TypeScript → XML
const xml = DomainChkDataCodec.encode(data);
```

### Type Safe

```typescript
interface DomainCheckResult {
  domains: Array<{
    name: string;
    available: boolean;
    reason?: string;
  }>;
}

// Codec enforces this type
const codec: z.ZodCodec<string, DomainCheckResult>;
```

## Zod 4 Codec API

Layer 2 will use Zod 4's `z.codec()`:

```typescript
import { z } from 'zod';

const MyCodec = z.codec<Input, Output>({
  decode: (input: Input): Output => { /* transform */ },
  encode: (output: Output): Input => { /* transform back */ },
});

// Usage
const output = MyCodec.decode(input);
const input = MyCodec.encode(output);
```

## Planned Implementation

### File Structure

```
generated/
└── my-pack/
    ├── elements/           # Layer 1 (existing)
    │   └── *.layer1.ts
    ├── codecs/             # Layer 2 (new)
    │   └── *.codec.ts
    └── types/              # Clean TypeScript interfaces
        └── *.types.ts
```

### Generated Files

#### Types File

```typescript
// domain.chkData.types.ts

export interface DomainCheckResult {
  domains: DomainCheckItem[];
}

export interface DomainCheckItem {
  name: string;
  available: boolean;
  reason?: string;
  reasonLang?: string;
}
```

#### Codec File

```typescript
// domain.chkData.codec.ts
import { z } from 'zod';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { DomainChkDataXml } from '../elements/domain.chkData.layer1.js';
import type { DomainCheckResult } from '../types/domain.chkData.types.js';

const DOMAIN_NS = 'urn:ietf:params:xml:ns:domain-1.0';

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  removeNSPrefix: false,
};

const builderOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  format: true,
};

export const DomainChkDataCodec = z.codec<string, DomainCheckResult>({
  decode: (xml: string): DomainCheckResult => {
    const parser = new XMLParser(parserOptions);
    const json = parser.parse(xml);

    // Extract the element (handle with or without namespace in root)
    const chkData = json['domain:chkData'] || json['chkData'];
    if (!chkData) {
      throw new Error('Missing domain:chkData element');
    }

    // Validate with Layer 1
    const validated = DomainChkDataXml.parse(chkData);

    // Transform to clean types
    const cds = Array.isArray(validated['domain:cd'])
      ? validated['domain:cd']
      : [validated['domain:cd']];

    return {
      domains: cds.map(cd => ({
        name: cd['domain:name']['#text'],
        available:
          cd['domain:name']['@_avail'] === 'true' ||
          cd['domain:name']['@_avail'] === '1',
        reason: cd['domain:reason']?.['#text'],
        reasonLang: cd['domain:reason']?.['@_lang'],
      })),
    };
  },

  encode: (data: DomainCheckResult): string => {
    const xmlJson = {
      'domain:chkData': {
        '@_xmlns:domain': DOMAIN_NS,
        'domain:cd': data.domains.map(d => ({
          'domain:name': {
            '@_avail': d.available ? '1' : '0',
            '#text': d.name,
          },
          ...(d.reason && {
            'domain:reason': {
              ...(d.reasonLang && { '@_lang': d.reasonLang }),
              '#text': d.reason,
            },
          }),
        })),
      },
    };

    const builder = new XMLBuilder(builderOptions);
    return builder.build(xmlJson);
  },
});

export type { DomainCheckResult };
```

## Transform Rules

### Naming Conventions

| XML | TypeScript |
|-----|------------|
| `domain:chkData` | `DomainCheckResult` |
| `domain:name` | `name` |
| `@_avail` | `available` |
| `@_lang` | `lang` (or contextual like `reasonLang`) |
| `#text` | Direct value or named property |

### Type Conversions

| XSD Type | Layer 1 | Layer 2 |
|----------|---------|---------|
| `xs:boolean` | `"true" \| "false" \| "1" \| "0"` | `boolean` |
| `xs:integer` | `string` (regex validated) | `number` |
| `xs:decimal` | `string` (regex validated) | `number` |
| `xs:dateTime` | `string` | `Date` or `string` (configurable) |
| `xs:date` | `string` | `Date` or `string` |
| Enum | `z.enum([...])` | TypeScript union type |

### Structure Flattening

#### Attributes + Text Content

Layer 1:
```typescript
{
  "domain:name": {
    "@_avail": "1",
    "#text": "example.com"
  }
}
```

Layer 2 options:

**Option A: Separate properties**
```typescript
{
  name: "example.com",
  nameAvail: true
}
```

**Option B: Nested object**
```typescript
{
  name: {
    value: "example.com",
    available: true
  }
}
```

### Choice Handling

Layer 1 union:
```typescript
z.union([
  z.object({ "epp:check": ... }),
  z.object({ "epp:create": ... }),
])
```

Layer 2 discriminated union:
```typescript
type EppCommand =
  | { type: 'check'; check: DomainCheck }
  | { type: 'create'; create: DomainCreate }
  | { type: 'info'; info: DomainInfo };
```

## Usage Examples

### Decode XML

```typescript
import { DomainChkDataCodec } from './generated/epp-core/codecs/domain.chkData.codec.js';

const xml = `
<domain:chkData xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
  <domain:cd>
    <domain:name avail="1">example.com</domain:name>
  </domain:cd>
</domain:chkData>
`;

const result = DomainChkDataCodec.decode(xml);
// { domains: [{ name: "example.com", available: true }] }

// Type-safe access
console.log(result.domains[0].available); // true
```

### Encode to XML

```typescript
const data = {
  domains: [
    { name: "example.com", available: true },
    { name: "taken.com", available: false, reason: "Already registered" },
  ],
};

const xml = DomainChkDataCodec.encode(data);
// <domain:chkData xmlns:domain="...">
//   <domain:cd>
//     <domain:name avail="1">example.com</domain:name>
//   </domain:cd>
//   <domain:cd>
//     <domain:name avail="0">taken.com</domain:name>
//     <domain:reason>Already registered</domain:reason>
//   </domain:cd>
// </domain:chkData>
```

### Round-Trip

```typescript
const original = { domains: [{ name: "test.com", available: true }] };

const xml = DomainChkDataCodec.encode(original);
const decoded = DomainChkDataCodec.decode(xml);

// decoded deeply equals original
```

## Configuration Options

Planned CLI options for Layer 2 generation:

```yaml
packs:
  - name: epp-core
    outDir: ./generated/epp-core
    files:
      - ./xsd/epp-1.0.xsd
    layer2:
      enabled: true
      dateHandling: string  # or 'date' for Date objects
      numberHandling: number  # or 'string' to keep as strings
      flattenSimpleContent: true
      discriminatorProperty: type  # for choice unions
```

## Implementation Plan

1. **Type Generator** - Generate clean TypeScript interfaces from XSD
2. **Decode Generator** - Generate XML → TypeScript transforms
3. **Encode Generator** - Generate TypeScript → XML transforms
4. **Codec Assembler** - Combine into `z.codec()` exports
5. **Config Options** - Add Layer 2 configuration to CLI

## Relationship to Layer 1

Layer 2 builds on Layer 1:

```typescript
// Inside codec decode:
const validated = DomainChkDataXml.parse(json);  // Layer 1 validation
return transform(validated);                       // Layer 2 transform
```

Benefits:
- Layer 1 catches structural errors
- Layer 2 focuses on transformation
- Clear separation of concerns
- Reusable validation logic

## See Also

- [Architecture Overview](./architecture.md)
- [Layer 1 Documentation](./layer1-xml-validation.md)
- [Zod Codecs](https://zod.dev/codecs)
