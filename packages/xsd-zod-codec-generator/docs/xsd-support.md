# XSD Support Matrix

Detailed breakdown of XML Schema (XSD) feature support in xsd-zod-codec-generator.

## Elements

| Feature | Status | Notes |
|---------|--------|-------|
| Global elements | ✅ | `<xs:element name="..." type="..."/>` |
| Local elements | ✅ | Elements inside complex types |
| Element refs | ✅ | `<xs:element ref="ns:name"/>` - generates imports |
| Default values | ✅ | `default="value"` |
| Fixed values | ✅ | `fixed="value"` → `z.literal()` |
| Nillable | ⚠️ | Parsed but not specially handled |
| Substitution groups | ❌ | Not implemented |
| Abstract elements | ❌ | Not implemented |

## Complex Types

| Feature | Status | Notes |
|---------|--------|-------|
| Named complex types | ✅ | `<xs:complexType name="...">` |
| Anonymous complex types | ✅ | Inline on elements |
| Sequence | ✅ | `<xs:sequence>` |
| Choice | ✅ | `<xs:choice>` → `z.union()` |
| All | ✅ | `<xs:all>` (treated as sequence) |
| Mixed content | ✅ | `mixed="true"` → `#text` optional |
| Empty content | ✅ | `z.object({})` |

## Simple Types

| Feature | Status | Notes |
|---------|--------|-------|
| Named simple types | ✅ | `<xs:simpleType name="...">` |
| Anonymous simple types | ✅ | Inline restrictions |
| Restriction | ✅ | `<xs:restriction base="...">` |
| Enumeration | ✅ | `<xs:enumeration>` → `z.enum()` |
| Pattern | ✅ | `<xs:pattern>` → `z.string().regex()` |
| MinLength | ✅ | `<xs:minLength>` → `z.string().min()` |
| MaxLength | ✅ | `<xs:maxLength>` → `z.string().max()` |
| Length | ⚠️ | Maps to min + max |
| MinInclusive | ⚠️ | Parsed, not enforced (strings in XML) |
| MaxInclusive | ⚠️ | Parsed, not enforced |
| MinExclusive | ⚠️ | Parsed, not enforced |
| MaxExclusive | ⚠️ | Parsed, not enforced |
| TotalDigits | ❌ | Not implemented |
| FractionDigits | ❌ | Not implemented |
| WhiteSpace | ❌ | Not implemented |
| List | ❌ | `<xs:list>` not implemented |
| Union | ❌ | `<xs:union>` (simpleType) not implemented |

## Attributes

| Feature | Status | Notes |
|---------|--------|-------|
| Required | ✅ | `use="required"` |
| Optional | ✅ | `use="optional"` (default) |
| Default | ✅ | `default="value"` → `.default()` |
| Fixed | ✅ | `fixed="value"` → `z.literal()` |
| Prohibited | ⚠️ | Parsed but treated as absent |
| AnyAttribute | ❌ | Not implemented |

## Content Models

| Feature | Status | Notes |
|---------|--------|-------|
| Simple content | ✅ | `<xs:simpleContent>` with extension |
| Complex content | ✅ | `<xs:complexContent>` |
| Extension | ✅ | `<xs:extension base="...">` |
| Restriction | ⚠️ | Parsed, base type used |

## Cardinality

| Feature | Status | Notes |
|---------|--------|-------|
| minOccurs="0" | ✅ | → `.optional()` |
| minOccurs="1" (default) | ✅ | Required |
| minOccurs > 1 | ✅ | → `z.array().min(n)` |
| maxOccurs="1" (default) | ✅ | Single value |
| maxOccurs="unbounded" | ✅ | → `z.array()` |
| maxOccurs > 1 | ✅ | → `z.array()` |

## Wildcards

| Feature | Status | Notes |
|---------|--------|-------|
| xs:any | ✅ | Allows extension, no validation |
| xs:anyAttribute | ❌ | Not implemented |
| namespace="##any" | ✅ | Any namespace allowed |
| namespace="##other" | ✅ | Other namespace allowed |
| namespace="##local" | ⚠️ | Treated as ##any |
| namespace="##targetNamespace" | ⚠️ | Treated as ##any |
| namespace="list" | ⚠️ | Treated as ##any |
| processContents="strict" | ⚠️ | Not enforced |
| processContents="lax" | ⚠️ | Not enforced |
| processContents="skip" | ✅ | Default behavior |

## Groups

| Feature | Status | Notes |
|---------|--------|-------|
| Named groups | ⚠️ | Parsed but not indexed |
| Group refs | ❌ | `<xs:group ref="..."/>` not resolved |
| Attribute groups | ❌ | Not implemented |
| Attribute group refs | ❌ | Not implemented |

## Schema Composition

| Feature | Status | Notes |
|---------|--------|-------|
| Import | ✅ | `<xs:import>` - cross-namespace |
| Include | ✅ | `<xs:include>` - same namespace |
| Redefine | ✅ | `<xs:redefine>` - loaded recursively |
| Chameleon includes | ⚠️ | Namespace handling may vary |

## Built-in Types

### String Types

| Type | Status | Zod Output |
|------|--------|------------|
| string | ✅ | `z.string()` |
| normalizedString | ✅ | `z.string()` |
| token | ✅ | `z.string()` |
| language | ✅ | `z.string()` |
| NMTOKEN | ✅ | `z.string()` |
| NMTOKENS | ⚠️ | `z.string()` (no list handling) |
| Name | ✅ | `z.string()` |
| NCName | ✅ | `z.string()` |
| ID | ✅ | `z.string()` |
| IDREF | ✅ | `z.string()` |
| IDREFS | ⚠️ | `z.string()` |
| ENTITY | ✅ | `z.string()` |
| ENTITIES | ⚠️ | `z.string()` |
| QName | ✅ | `z.string()` |
| anyURI | ✅ | `z.string()` |

### Binary Types

| Type | Status | Zod Output |
|------|--------|------------|
| base64Binary | ✅ | `z.string()` |
| hexBinary | ✅ | `z.string()` |

### Boolean

| Type | Status | Zod Output |
|------|--------|------------|
| boolean | ✅ | `z.union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])` |

### Numeric Types

| Type | Status | Zod Output |
|------|--------|------------|
| decimal | ✅ | `z.string().regex(/^-?\d+(\.\d+)?$/)` |
| float | ✅ | `z.string().regex(/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/)` |
| double | ✅ | `z.string().regex(/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/)` |
| integer | ✅ | `z.string().regex(/^-?\d+$/)` |
| long | ✅ | `z.string().regex(/^-?\d+$/)` |
| int | ✅ | `z.string().regex(/^-?\d+$/)` |
| short | ✅ | `z.string().regex(/^-?\d+$/)` |
| byte | ✅ | `z.string().regex(/^-?\d+$/)` |
| nonPositiveInteger | ✅ | `z.string().regex(/^-?\d+$/)` |
| negativeInteger | ✅ | `z.string().regex(/^-?\d+$/)` |
| nonNegativeInteger | ✅ | `z.string().regex(/^-?\d+$/)` |
| positiveInteger | ✅ | `z.string().regex(/^-?\d+$/)` |
| unsignedLong | ✅ | `z.string().regex(/^-?\d+$/)` |
| unsignedInt | ✅ | `z.string().regex(/^-?\d+$/)` |
| unsignedShort | ✅ | `z.string().regex(/^-?\d+$/)` |
| unsignedByte | ✅ | `z.string().regex(/^-?\d+$/)` |

### Date/Time Types

| Type | Status | Zod Output |
|------|--------|------------|
| dateTime | ✅ | `z.string()` |
| date | ✅ | `z.string()` |
| time | ✅ | `z.string()` |
| duration | ✅ | `z.string()` |
| gYear | ✅ | `z.string()` |
| gYearMonth | ✅ | `z.string()` |
| gMonth | ✅ | `z.string()` |
| gMonthDay | ✅ | `z.string()` |
| gDay | ✅ | `z.string()` |

### Special Types

| Type | Status | Zod Output |
|------|--------|------------|
| anyType | ✅ | `z.unknown()` |
| anySimpleType | ✅ | `z.unknown()` |

## Identity Constraints

| Feature | Status | Notes |
|---------|--------|-------|
| xs:key | ❌ | Not implemented |
| xs:keyref | ❌ | Not implemented |
| xs:unique | ❌ | Not implemented |

## Notation

| Feature | Status | Notes |
|---------|--------|-------|
| xs:notation | ❌ | Not implemented |

## Namespace Handling

| Feature | Status | Notes |
|---------|--------|-------|
| targetNamespace | ✅ | Used for QName resolution |
| elementFormDefault | ✅ | Handled |
| attributeFormDefault | ⚠️ | Assumed unqualified |
| Namespace prefixes | ✅ | Preserved in output keys |
| Default namespace | ✅ | Unprefixed schema elements supported |
| Multiple prefixes for same NS | ⚠️ | First prefix used |

## Legend

- ✅ Fully supported
- ⚠️ Partially supported or with caveats
- ❌ Not implemented

## Requesting Features

If you need a feature that's not implemented:

1. Check if there's a workaround
2. Open an issue with your XSD example
3. PRs welcome for new features

## See Also

- [Architecture](./architecture.md)
- [Layer 1 Documentation](./layer1-xml-validation.md)
- [W3C XML Schema Specification](https://www.w3.org/TR/xmlschema-1/)
