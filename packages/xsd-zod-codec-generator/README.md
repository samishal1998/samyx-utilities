# xsd-zod-codec-generator

Generate type-safe [Zod](https://zod.dev) schemas from XML Schema (XSD) files.

## Installation

```bash
bun add xsd-zod-codec-generator
# or
npm install xsd-zod-codec-generator
```

## Features

- **XSD to Zod** - Generate Zod validation schemas from XSD files
- **Schema Reuse** - Element refs generate imports instead of inlining
- **Choice as Union** - `<xs:choice>` maps to `z.union([...])`
- **Branded Types** - All elements are branded with `schema.brand<"ns:element">()`
- **Namespace Support** - Full namespace prefix handling in generated schemas
- **Dependency Resolution** - Automatic `<import>`, `<include>`, `<redefine>` resolution

## Quick Start

### CLI Usage

Create a config file `schema-packs.config.yml`:

```yaml
packs:
  - name: my-schemas
    outDir: ./generated/my-schemas
    files:
      - ./xsd/schema1.xsd
      - ./xsd/schema2.xsd
```

Generate schemas:

```bash
npx xsd-zod generate -c schema-packs.config.yml
```

### Programmatic Usage

```typescript
import { buildSchemaGraph, generateFromSchemaGraph, writeGeneratedCode } from 'xsd-zod-codec-generator';

// Build schema graph from XSD files
const graph = await buildSchemaGraph('my-pack', [
  './xsd/schema1.xsd',
  './xsd/schema2.xsd',
]);

// Generate Zod schemas
const result = generateFromSchemaGraph(graph);

// Write to disk
await writeGeneratedCode(result, './generated/my-schemas');
```

## Generated Output

Given an XSD like:

```xml
<xs:element name="check" type="domain:mNameType" />

<xs:complexType name="mNameType">
  <xs:sequence>
    <xs:element name="name" type="xs:string" maxOccurs="unbounded" />
  </xs:sequence>
</xs:complexType>
```

Generates:

```typescript
// domain.check.layer1.ts
import { z } from 'zod';

export const DomainCheckXml = z.object({
  "domain:name": z.array(z.string()).min(1),
}).brand<"domain:check">();

export type DomainCheckXml = z.infer<typeof DomainCheckXml>;
```

### Choice Handling

XSD `<xs:choice>` generates `z.union()` with base properties spread into each option:

```xml
<xs:complexType name="commandType">
  <xs:sequence>
    <xs:choice>
      <xs:element name="check" type="checkType" />
      <xs:element name="create" type="createType" />
    </xs:choice>
    <xs:element name="clTRID" type="xs:string" minOccurs="0" />
  </xs:sequence>
</xs:complexType>
```

Generates:

```typescript
z.union([
  z.object({
    "epp:clTRID": z.string().optional(),
    "epp:check": CheckTypeXml,
  }),
  z.object({
    "epp:clTRID": z.string().optional(),
    "epp:create": CreateTypeXml,
  }),
])
```

### Element References

Element refs generate imports instead of inlining:

```typescript
import { DomainCheckXml } from './domain.check.layer1.js';

export const EppCommandXml = z.object({
  "domain:check": DomainCheckXml,  // imported, not inlined
});
```

## CLI Options

```
xsd-zod generate [options]

Options:
  -c, --config <path>       Path to configuration file (YAML/JSON) (required)
  -p, --pack <name...>      Generate only specific pack(s)
  --emit-complex-types      Also emit schemas for named complex types
  --dry-run                 Load and validate schemas without writing files
  -h, --help                Display help
```

## Configuration

### YAML Config

```yaml
packs:
  - name: epp-core
    outDir: ./generated/epp-core
    files:
      - ./xsd/epp-1.0.xsd
      - ./xsd/domain-1.0.xsd
    rootNamespaces:
      - urn:ietf:params:xml:ns:epp-1.0
      - urn:ietf:params:xml:ns:domain-1.0
```

### JSON Config

```json
{
  "packs": [
    {
      "name": "epp-core",
      "outDir": "./generated/epp-core",
      "files": ["./xsd/epp-1.0.xsd", "./xsd/domain-1.0.xsd"]
    }
  ]
}
```

### Config Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Pack name (used in generated metadata) |
| `outDir` | string | Output directory for generated files |
| `files` | string[] | XSD files to process |
| `rootNamespaces` | string[] | Only emit elements from these namespaces |

## XSD Support

### Supported

| Feature | Status |
|---------|--------|
| `<xs:element>` | ✅ Global and local elements |
| `<xs:complexType>` | ✅ With sequence, choice, all |
| `<xs:simpleType>` | ✅ Restrictions, enumerations, patterns |
| `<xs:attribute>` | ✅ Required, optional, default, fixed |
| `<xs:sequence>` | ✅ |
| `<xs:choice>` | ✅ Maps to `z.union()` |
| `<xs:all>` | ✅ |
| `<xs:any>` | ✅ Allows extension |
| `<xs:extension>` | ✅ Simple and complex content |
| `<xs:restriction>` | ✅ |
| `<xs:import>` | ✅ Cross-namespace |
| `<xs:include>` | ✅ Same-namespace |
| `<xs:redefine>` | ✅ |
| `<xs:element ref>` | ✅ Generates imports |
| Mixed content | ✅ `mixed="true"` |
| Default namespace | ✅ Unprefixed schema elements |

### Not Yet Supported

| Feature | Status |
|---------|--------|
| `<xs:group ref>` | ❌ Parsed but not resolved |
| `<xs:attributeGroup>` | ❌ |
| `<xs:list>` | ❌ |
| `<xs:union>` (simpleType) | ❌ |
| `<xs:key>` / `<xs:keyref>` | ❌ |
| `<xs:unique>` | ❌ |
| Substitution groups | ❌ |

## Output Structure

```
generated/
└── my-pack/
    ├── index.ts           # Re-exports all schemas
    ├── schema-meta.ts     # Pack metadata (namespaces, elements)
    └── elements/
        ├── ns.element1.layer1.ts
        ├── ns.element2.layer1.ts
        └── ...
```

## License

MIT
