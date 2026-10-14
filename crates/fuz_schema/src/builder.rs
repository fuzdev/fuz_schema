//! The builder: how a `Schema` is made, and where one the crate does not
//! carry across from the TypeScript library is refused.

use std::collections::HashSet;

use crate::bits::Bits;
use crate::error::{SchemaBuildError, SchemaBuildErrorKind};
use crate::js;
use crate::json::{self, Json, Value};
use crate::schema::{
    Candidates, MAX_NESTING, NodeId, Schema, SchemaEntries, SchemaKind, SchemaLiteral, SchemaNode,
    VariantDef, WithDefaultDef,
};
use crate::walk;

/// Builds a `Schema` one node at a time.
///
/// Every method but `build` adds a node and returns its id, to give to the
/// methods that take schemas. A schema that refers to itself declares a
/// `lazy`, uses its id, and defines it once the schema it defers to exists:
///
/// ```
/// use fuz_schema::SchemaBuilder;
///
/// let mut builder = SchemaBuilder::new();
/// let tree = builder.declare();
/// let children = builder.array(tree);
/// let node = builder.object([("children", children)]);
/// builder.define(tree, node);
/// let schema = builder.build(tree)?;
/// assert!(schema.matches_json(r#"{"children":[{"children":[]}]}"#)?);
/// assert!(!schema.matches_json(r#"{"children":[1]}"#)?);
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
///
/// Nothing is checked until `build`, which refuses what the crate does not
/// carry across from the TypeScript library.
#[derive(Debug, Clone, Default)]
pub struct SchemaBuilder {
    nodes: Vec<SchemaNode>,
    /// Every `lazy`, with the name its target has in the interchange form.
    lazies: Vec<(NodeId, Box<str>)>,
    /// A `define` that could not be done, reported by `build`.
    deferred: Option<SchemaBuildErrorKind>,
}

impl SchemaBuilder {
    /// A builder with no nodes.
    pub fn new() -> Self {
        Self::default()
    }

    fn push(&mut self, node: SchemaNode) -> NodeId {
        let id = NodeId::new(self.nodes.len());
        self.nodes.push(node);
        id
    }

    /// Matches a string.
    pub fn string(&mut self) -> NodeId {
        self.push(SchemaNode::String)
    }

    /// Matches a finite number, which every number of a JSON text the crate
    /// reads is.
    pub fn number(&mut self) -> NodeId {
        self.push(SchemaNode::Number)
    }

    /// Matches a boolean.
    pub fn boolean(&mut self) -> NodeId {
        self.push(SchemaNode::Boolean)
    }

    /// Matches a bigint, which JSON never holds.
    pub fn bigint(&mut self) -> NodeId {
        self.push(SchemaNode::Bigint)
    }

    /// Matches anything, and needs the key of the entry it is reached from:
    /// as the entry itself, and under a `nullable`, a `lazy`, or a `union`.
    pub fn unknown(&mut self) -> NodeId {
        self.push(SchemaNode::Unknown)
    }

    /// Matches `value` by JavaScript's `===`.
    pub fn literal(&mut self, value: impl Into<SchemaLiteral>) -> NodeId {
        self.push(SchemaNode::Literal(value.into()))
    }

    /// Matches any of `values`.
    pub fn one_of<T: Into<SchemaLiteral>>(
        &mut self,
        values: impl IntoIterator<Item = T>,
    ) -> NodeId {
        self.push(SchemaNode::OneOf(
            values.into_iter().map(Into::into).collect(),
        ))
    }

    /// Accepts a missing key, or matches `schema`.
    pub fn optional(&mut self, schema: NodeId) -> NodeId {
        self.push(SchemaNode::Optional(schema))
    }

    /// Accepts `null`, or matches `schema`.
    pub fn nullable(&mut self, schema: NodeId) -> NodeId {
        self.push(SchemaNode::Nullable(schema))
    }

    /// Accepts a missing key, or matches `schema`. `value` is what the key is
    /// given in the output, and is not validated.
    pub fn with_default(&mut self, schema: NodeId, value: Json) -> NodeId {
        self.push(SchemaNode::WithDefault(Box::new(WithDefaultDef {
            schema,
            value,
        })))
    }

    /// Declares a `lazy`, to be given the schema it defers to with `define`.
    pub fn declare(&mut self) -> NodeId {
        let name = format!("${}", self.lazies.len());
        self.declare_named(name.into_boxed_str())
    }

    /// Declares a `lazy` whose target has `name` in the interchange form.
    pub(crate) fn declare_named(&mut self, name: Box<str>) -> NodeId {
        let id = self.push(SchemaNode::Lazy(NodeId::UNDEFINED));
        self.lazies.push((id, name));
        id
    }

    /// Gives the `lazy` declared as `lazy` the schema it defers to.
    ///
    /// A `lazy` that is not one `declare` returned, or that is already
    /// defined, makes `build` fail.
    pub fn define(&mut self, lazy: NodeId, schema: NodeId) {
        match self.nodes.get_mut(lazy.index()) {
            Some(SchemaNode::Lazy(target)) if *target == NodeId::UNDEFINED => *target = schema,
            Some(SchemaNode::Lazy(_)) => {
                self.deferred
                    .get_or_insert(SchemaBuildErrorKind::RedefinedLazy);
            }
            _ => {
                self.deferred
                    .get_or_insert(SchemaBuildErrorKind::InvalidNode);
            }
        }
    }

    fn entries<K: Into<Box<str>>>(entries: impl IntoIterator<Item = (K, NodeId)>) -> SchemaEntries {
        let entries = entries
            .into_iter()
            .map(|(key, schema)| (key.into(), schema))
            .collect();
        SchemaEntries::new(entries)
    }

    /// Matches an object with `entries` and no other key.
    pub fn object<K: Into<Box<str>>>(
        &mut self,
        entries: impl IntoIterator<Item = (K, NodeId)>,
    ) -> NodeId {
        self.push(SchemaNode::Object(Box::new(Self::entries(entries))))
    }

    /// Matches an object with `entries`, whatever other keys it has.
    pub fn loose_object<K: Into<Box<str>>>(
        &mut self,
        entries: impl IntoIterator<Item = (K, NodeId)>,
    ) -> NodeId {
        self.push(SchemaNode::LooseObject(Box::new(Self::entries(entries))))
    }

    /// Matches an object with `entries`, whatever other keys it has.
    pub fn strip_object<K: Into<Box<str>>>(
        &mut self,
        entries: impl IntoIterator<Item = (K, NodeId)>,
    ) -> NodeId {
        self.push(SchemaNode::StripObject(Box::new(Self::entries(entries))))
    }

    /// Matches an object whose values all match `schema`.
    pub fn record(&mut self, schema: NodeId) -> NodeId {
        self.push(SchemaNode::Record(schema))
    }

    /// Matches an array whose items all match `schema`.
    pub fn array(&mut self, schema: NodeId) -> NodeId {
        self.push(SchemaNode::Array(schema))
    }

    /// Matches when any of `options` does, tried in order.
    pub fn union(&mut self, options: impl IntoIterator<Item = NodeId>) -> NodeId {
        self.push(SchemaNode::Union(options.into_iter().collect()))
    }

    /// Matches the object schema in `options` whose `literal` entry at `key`
    /// equals the value's.
    pub fn variant(
        &mut self,
        key: impl Into<Box<str>>,
        options: impl IntoIterator<Item = NodeId>,
    ) -> NodeId {
        self.push(SchemaNode::Variant(Box::new(VariantDef {
            key: key.into(),
            options: options.into_iter().collect(),
            table: Box::default(),
        })))
    }

    /// Matches when every one of `steps` does: a schema that fixes the type
    /// of the value, then actions for that type.
    pub fn pipe(&mut self, steps: impl IntoIterator<Item = NodeId>) -> NodeId {
        self.push(SchemaNode::Pipe(steps.into_iter().collect()))
    }

    /// An action: a string or array of at least `min` length.
    pub fn min_length(&mut self, min: f64) -> NodeId {
        self.push(SchemaNode::MinLength(min))
    }

    /// An action: a string or array of at most `max` length.
    pub fn max_length(&mut self, max: f64) -> NodeId {
        self.push(SchemaNode::MaxLength(max))
    }

    /// An action: a number at least `min`.
    pub fn min_value(&mut self, min: f64) -> NodeId {
        self.push(SchemaNode::MinValue(min))
    }

    /// An action: a number at most `max`.
    pub fn max_value(&mut self, max: f64) -> NodeId {
        self.push(SchemaNode::MaxValue(max))
    }

    /// Matches a number with no fraction. An action too.
    pub fn integer(&mut self) -> NodeId {
        self.push(SchemaNode::Integer)
    }

    /// Matches an integer every neighbor of which is a distinct double. An
    /// action too.
    pub fn safe_integer(&mut self) -> NodeId {
        self.push(SchemaNode::SafeInteger)
    }

    /// Checks the nodes reachable from `root` and from every defined `lazy`,
    /// and makes the schema that starts at `root`.
    ///
    /// # Errors
    ///
    /// When the schema is one the crate refuses, with the reason and a path to
    /// it. See `SchemaBuildErrorKind`.
    pub fn build(self, root: NodeId) -> Result<Schema, SchemaBuildError> {
        let Self {
            mut nodes,
            lazies,
            deferred,
        } = self;
        // no schema is made that the evaluators would misread a number under
        if !json::parser_reads_numbers() {
            return Err(SchemaBuildError::new(
                SchemaBuildErrorKind::ArbitraryPrecision,
                "",
            ));
        }
        if let Some(kind) = deferred {
            return Err(SchemaBuildError::new(kind, ""));
        }
        if nodes.len() >= NodeId::UNDEFINED.index() {
            return Err(SchemaBuildError::new(
                SchemaBuildErrorKind::TooManyNodes,
                "",
            ));
        }
        let order = Checker::new(&nodes, &lazies, root)?.check()?;
        for node in &mut nodes {
            if let SchemaNode::Object(entries)
            | SchemaNode::LooseObject(entries)
            | SchemaNode::StripObject(entries) = node
            {
                entries.finish();
            }
        }
        for &id in &order {
            if let SchemaNode::Variant(variant) = &nodes[id.index()] {
                let table = variant_table(&nodes, variant);
                if let SchemaNode::Variant(variant) = &mut nodes[id.index()] {
                    variant.table = table;
                }
            }
        }
        // a node out of reach was not checked, is never evaluated, and reads
        // as not accepting
        let mut memo = vec![None; nodes.len()];
        for &id in &order {
            accepts_any(&nodes, id, &mut memo);
        }
        let any = memo.into_iter().map(|any| any == Some(true)).collect();
        let mut memo = vec![None; nodes.len()];
        let mut candidates = vec![[Candidates::None; 2]; nodes.len()];
        for &id in &order {
            if let SchemaNode::Union(options) = &nodes[id.index()] {
                candidates[id.index()] = union_candidates(&nodes, options, &mut memo);
            }
        }
        let mut schema = Schema {
            nodes: nodes.into_boxed_slice(),
            root,
            any,
            candidates: candidates.into_boxed_slice(),
        };
        // an entry is required when a missing key fails it, which the tree
        // evaluator is asked
        for &id in &order {
            let Some(entries) = schema.at(id).entries() else {
                continue;
            };
            let mut required = Bits::new(entries.len());
            for (position, (_, entry)) in entries.iter().enumerate() {
                if !walk::run(&schema, entry, Value::Undefined, &mut walk::Probe) {
                    required.insert(position);
                }
            }
            if let SchemaNode::Object(entries)
            | SchemaNode::LooseObject(entries)
            | SchemaNode::StripObject(entries) = &mut schema.nodes[id.index()]
            {
                entries.required = required;
            }
        }
        Ok(schema)
    }
}

/// The discriminator values of a variant's options and the option each
/// selects.
fn variant_table(nodes: &[SchemaNode], variant: &VariantDef) -> Box<[(SchemaLiteral, NodeId)]> {
    let mut table: Vec<(SchemaLiteral, NodeId)> = Vec::new();
    for &option in &variant.options {
        let literal = nodes
            .get(option.index())
            .and_then(SchemaNode::entries)
            .and_then(|entries| entries.get(&variant.key))
            .and_then(|entry| nodes.get(entry.index()));
        // an option without one was refused, or is out of reach of the root
        let Some(SchemaNode::Literal(literal)) = literal else {
            continue;
        };
        // equal as the values of a `Map` key are: `0` and `-0` are one key
        let same = |known: &SchemaLiteral| match (known, literal) {
            (SchemaLiteral::Number(a), SchemaLiteral::Number(b)) => js::number_equals(*a, *b),
            _ => known == literal,
        };
        if let Some(known) = table.iter_mut().find(|(known, _)| same(known)) {
            known.1 = option;
        } else {
            table.push((literal.clone(), option));
        }
    }
    table.into_boxed_slice()
}

/// Whether the node accepts every value that is present.
///
/// Recurses only along `SchemaNode::nesting`, which `Checker` has bounded for the
/// nodes it reached, the only ones this is asked of.
fn accepts_any(nodes: &[SchemaNode], id: NodeId, memo: &mut [Option<bool>]) -> bool {
    if let Some(known) = memo[id.index()] {
        return known;
    }
    let node = &nodes[id.index()];
    let any = match node {
        SchemaNode::Unknown => true,
        SchemaNode::Optional(_)
        | SchemaNode::Nullable(_)
        | SchemaNode::WithDefault(_)
        | SchemaNode::Lazy(_) => node
            .nesting()
            .iter()
            .all(|&schema| accepts_any(nodes, schema, memo)),
        SchemaNode::Union(options) => options
            .iter()
            .any(|&option| accepts_any(nodes, option, memo)),
        _ => false,
    };
    memo[id.index()] = Some(any);
    any
}

/// Whether the node could match an array, and whether it could an object.
///
/// It could when what it steps to for the same value could: a wrapper, a
/// `lazy`, and the first schema of a `pipe` are looked through, and a `union`
/// could when any option could. The answer is of the kind and not of what is
/// held, so an array schema could match an array whatever its items are.
///
/// Recurses only along `SchemaNode::nesting`, as `accepts_any` does.
fn holds_containers(nodes: &[SchemaNode], id: NodeId, memo: &mut [Option<[bool; 2]>]) -> [bool; 2] {
    if let Some(known) = memo[id.index()] {
        return known;
    }
    let node = &nodes[id.index()];
    let holds = match node {
        SchemaNode::Unknown => [true, true],
        SchemaNode::Array(_) => [true, false],
        SchemaNode::Object(_)
        | SchemaNode::LooseObject(_)
        | SchemaNode::StripObject(_)
        | SchemaNode::Record(_)
        | SchemaNode::Variant(_) => [false, true],
        // the rest are scalars and actions, which step nowhere
        _ => node.nesting().iter().fold([false, false], |holds, &next| {
            let [array, object] = holds_containers(nodes, next, memo);
            [holds[0] || array, holds[1] || object]
        }),
    };
    memo[id.index()] = Some(holds);
    holds
}

/// The candidates of a `union` with `options`, for an array and for an object.
fn union_candidates(
    nodes: &[SchemaNode],
    options: &[NodeId],
    memo: &mut [Option<[bool; 2]>],
) -> [Candidates; 2] {
    let mut candidates = [Candidates::None; 2];
    for &option in options {
        let holds = holds_containers(nodes, option, memo);
        for (candidates, holds) in candidates.iter_mut().zip(holds) {
            if holds {
                *candidates = match candidates {
                    Candidates::None => Candidates::One(option),
                    _ => Candidates::Many,
                };
            }
        }
    }
    candidates
}

/// What a step of a pipe has fixed the value to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ValueType {
    String,
    Number,
    Array,
}

/// How a node is reached from the one before it on its path.
#[derive(Debug, Clone, Copy)]
enum Step {
    /// The `def` itself: the schema of an `array`, `record`, or `lazy`.
    Def,
    /// `def.schema`, of a wrapper.
    Schema,
    /// `def[key]`, the entry at this position of an object schema.
    Entry(usize),
    /// `def[index]`, of a `union`, a `pipe`, or the values of a `one_of`.
    Index(usize),
    /// `def.options[index]`, of a `variant`.
    Option(usize),
    /// `def.key`, of a `variant`.
    Key,
}

/// Where a reachable node was first reached from.
#[derive(Debug, Clone, Copy)]
enum Origin {
    Unreached,
    /// A root, by its position in `Checker::roots`.
    Root(usize),
    Child(NodeId, Step),
}

/// The checks `SchemaBuilder::build` makes, over the nodes reachable from the
/// root and from every `lazy` target.
struct Checker<'a> {
    nodes: &'a [SchemaNode],
    /// The path of each root and its node: the schema, then each lazy target
    /// under the name it has in the interchange form.
    roots: Vec<(String, NodeId)>,
    origins: Vec<Origin>,
    /// The reachable nodes, in the order they were reached.
    order: Vec<NodeId>,
}

type Refusal = (SchemaBuildErrorKind, NodeId, Option<Step>);

impl<'a> Checker<'a> {
    /// Finds the reachable nodes, refusing an id that is not the builder's.
    fn new(
        nodes: &'a [SchemaNode],
        lazies: &[(NodeId, Box<str>)],
        root: NodeId,
    ) -> Result<Self, SchemaBuildError> {
        let mut roots = vec![("/schema".to_owned(), root)];
        let mut named: HashSet<&str> = HashSet::new();
        for (lazy, name) in lazies {
            if let Some(SchemaNode::Lazy(target)) = nodes.get(lazy.index())
                && *target != NodeId::UNDEFINED
                && named.insert(&**name)
            {
                roots.push((format!("/defs/{}", pointer_token(name)), *target));
            }
        }
        let mut checker = Self {
            nodes,
            roots,
            origins: vec![Origin::Unreached; nodes.len()],
            order: Vec::new(),
        };
        checker.reach()?;
        Ok(checker)
    }

    fn reach(&mut self) -> Result<(), SchemaBuildError> {
        let nodes = self.nodes;
        for root in 0..self.roots.len() {
            let id = self.roots[root].1;
            if id.index() >= nodes.len() {
                let path = self.roots[root].0.clone();
                return Err(SchemaBuildError::new(
                    SchemaBuildErrorKind::InvalidNode,
                    path,
                ));
            }
            if !matches!(self.origins[id.index()], Origin::Unreached) {
                continue;
            }
            self.origins[id.index()] = Origin::Root(root);
            let mut next = self.order.len();
            self.order.push(id);
            while let Some(&parent) = self.order.get(next) {
                next += 1;
                let node = &nodes[parent.index()];
                // a lazy's target is a root of its own
                if matches!(node, SchemaNode::Lazy(_)) {
                    continue;
                }
                let mut refused = None;
                for_each_child(node, |step, child| {
                    // a node refers only to nodes made before it, so that
                    // only a lazy can close a cycle
                    if child.index() >= parent.index() {
                        refused.get_or_insert(step);
                    } else if matches!(self.origins[child.index()], Origin::Unreached) {
                        self.origins[child.index()] = Origin::Child(parent, step);
                        self.order.push(child);
                    }
                });
                if let Some(step) = refused {
                    return Err(self.error(SchemaBuildErrorKind::InvalidNode, parent, Some(step)));
                }
            }
        }
        Ok(())
    }

    /// Checks every reachable node and returns them.
    fn check(self) -> Result<Vec<NodeId>, SchemaBuildError> {
        for (_, root) in &self.roots {
            let kind = self.nodes[root.index()].kind();
            if kind.needs_pipe() {
                return Err(self.error(
                    SchemaBuildErrorKind::ActionOutsidePipe { kind },
                    *root,
                    None,
                ));
            }
        }
        for &id in &self.order {
            self.check_node(id)
                .map_err(|(kind, node, step)| self.error(kind, node, step))?;
        }
        self.check_nesting()
            .map_err(|(kind, node, step)| self.error(kind, node, step))?;
        Ok(self.order)
    }

    fn kind(&self, id: NodeId) -> SchemaKind {
        self.nodes[id.index()].kind()
    }

    /// The checks of one node and of how it uses its children.
    fn check_node(&self, id: NodeId) -> Result<(), Refusal> {
        let node = &self.nodes[id.index()];
        let outside_pipe = |step: Step, child: NodeId| {
            let kind = self.kind(child);
            if kind.needs_pipe() {
                Err((
                    SchemaBuildErrorKind::ActionOutsidePipe { kind },
                    id,
                    Some(step),
                ))
            } else {
                Ok(())
            }
        };
        match node {
            SchemaNode::Literal(literal) => {
                if !literal.is_finite() {
                    return Err((SchemaBuildErrorKind::NonFiniteNumber, id, Some(Step::Def)));
                }
            }
            SchemaNode::OneOf(literals) => {
                if let Some(index) = literals.iter().position(|literal| !literal.is_finite()) {
                    return Err((
                        SchemaBuildErrorKind::NonFiniteNumber,
                        id,
                        Some(Step::Index(index)),
                    ));
                }
            }
            SchemaNode::MinLength(bound)
            | SchemaNode::MaxLength(bound)
            | SchemaNode::MinValue(bound)
            | SchemaNode::MaxValue(bound) => {
                if !bound.is_finite() {
                    return Err((SchemaBuildErrorKind::NonFiniteNumber, id, Some(Step::Def)));
                }
            }
            SchemaNode::Optional(schema) | SchemaNode::Nullable(schema) => {
                outside_pipe(Step::Schema, *schema)?;
            }
            SchemaNode::WithDefault(default) => outside_pipe(Step::Schema, default.schema)?,
            SchemaNode::Lazy(target) => {
                if *target == NodeId::UNDEFINED {
                    return Err((SchemaBuildErrorKind::UndefinedLazy, id, None));
                }
                // the target is a root, and checked as one
            }
            SchemaNode::Record(schema) | SchemaNode::Array(schema) => {
                outside_pipe(Step::Def, *schema)?;
            }
            SchemaNode::Object(entries)
            | SchemaNode::LooseObject(entries)
            | SchemaNode::StripObject(entries) => {
                for (position, (key, schema)) in entries.iter().enumerate() {
                    if js::OBJECT_PROTOTYPE_KEYS.contains(&key) {
                        return Err((
                            SchemaBuildErrorKind::PrototypeKey { key: key.into() },
                            id,
                            Some(Step::Entry(position)),
                        ));
                    }
                    outside_pipe(Step::Entry(position), schema)?;
                }
                let mut keys: Vec<&str> = entries.iter().map(|(key, _)| key).collect();
                keys.sort_unstable();
                if let Some(pair) = keys.windows(2).find(|pair| pair[0] == pair[1]) {
                    return Err((
                        SchemaBuildErrorKind::DuplicateKey {
                            key: pair[0].into(),
                        },
                        id,
                        None,
                    ));
                }
            }
            SchemaNode::Union(options) => {
                for (index, &option) in options.iter().enumerate() {
                    outside_pipe(Step::Index(index), option)?;
                }
            }
            SchemaNode::Variant(variant) => {
                // with options the key is an entry of each, and refused there
                if variant.options.is_empty() && js::OBJECT_PROTOTYPE_KEYS.contains(&&*variant.key)
                {
                    let key = variant.key.clone();
                    return Err((
                        SchemaBuildErrorKind::PrototypeKey { key },
                        id,
                        Some(Step::Key),
                    ));
                }
                for (index, &option) in variant.options.iter().enumerate() {
                    let step = Some(Step::Option(index));
                    let Some(entries) = self.nodes[option.index()].entries() else {
                        let kind = self.kind(option);
                        return Err((SchemaBuildErrorKind::VariantOption { kind }, id, step));
                    };
                    let literal = entries
                        .get(&variant.key)
                        .is_some_and(|entry| self.kind(entry) == SchemaKind::Literal);
                    if !literal {
                        let key = variant.key.clone();
                        return Err((SchemaBuildErrorKind::VariantDiscriminator { key }, id, step));
                    }
                }
            }
            SchemaNode::Pipe(steps) => self.check_pipe(id, steps)?,
            SchemaNode::String
            | SchemaNode::Number
            | SchemaNode::Boolean
            | SchemaNode::Bigint
            | SchemaNode::Unknown
            | SchemaNode::Integer
            | SchemaNode::SafeInteger => {}
        }
        Ok(())
    }

    fn check_pipe(&self, id: NodeId, steps: &[NodeId]) -> Result<(), Refusal> {
        let Some((&head, actions)) = steps.split_first() else {
            return Err((SchemaBuildErrorKind::EmptyPipe, id, None));
        };
        let Some(value_type) = self.value_type(head) else {
            let kind = self.kind(head);
            return Err((
                SchemaBuildErrorKind::PipeHead { kind },
                id,
                Some(Step::Index(0)),
            ));
        };
        for (index, &action) in actions.iter().enumerate() {
            let kind = self.kind(action);
            let step = Some(Step::Index(index + 1));
            if !kind.is_action() {
                return Err((SchemaBuildErrorKind::PipeStep { kind }, id, step));
            }
            let fits = match kind {
                SchemaKind::MinLength | SchemaKind::MaxLength => value_type != ValueType::Number,
                _ => value_type == ValueType::Number,
            };
            if !fits {
                return Err((SchemaBuildErrorKind::ActionMismatch { kind }, id, step));
            }
        }
        Ok(())
    }

    /// The type a node fixes its value to be, when it fixes one.
    fn value_type(&self, mut id: NodeId) -> Option<ValueType> {
        // a pipe's first step was made before the pipe, so this ends
        loop {
            match &self.nodes[id.index()] {
                SchemaNode::String => return Some(ValueType::String),
                SchemaNode::Number | SchemaNode::Integer | SchemaNode::SafeInteger => {
                    return Some(ValueType::Number);
                }
                SchemaNode::Array(_) => return Some(ValueType::Array),
                SchemaNode::Pipe(steps) => id = *steps.first()?,
                _ => return None,
            }
        }
    }

    /// Refuses a schema that comes back to itself without reading into the
    /// value, and one that nests further than `MAX_NESTING`.
    fn check_nesting(&self) -> Result<(), Refusal> {
        const NEW: u8 = 0;
        const OPEN: u8 = 1;
        const DONE: u8 = 2;
        let mut state = vec![NEW; self.nodes.len()];
        let mut depth = vec![0usize; self.nodes.len()];
        let mut stack: Vec<(NodeId, usize)> = Vec::new();
        for &start in &self.order {
            if state[start.index()] != NEW {
                continue;
            }
            state[start.index()] = OPEN;
            stack.push((start, 0));
            while let Some((id, next)) = stack.last_mut() {
                let id = *id;
                let nesting = self.nodes[id.index()].nesting();
                if let Some(&child) = nesting.get(*next) {
                    *next += 1;
                    match state[child.index()] {
                        NEW => {
                            state[child.index()] = OPEN;
                            stack.push((child, 0));
                        }
                        OPEN => {
                            return Err((SchemaBuildErrorKind::UnguardedRecursion, child, None));
                        }
                        _ => {}
                    }
                } else {
                    let below = nesting.iter().map(|child| depth[child.index()]).max();
                    depth[id.index()] = below.map_or(0, |below| below + 1);
                    if depth[id.index()] > MAX_NESTING {
                        let limit = MAX_NESTING;
                        return Err((SchemaBuildErrorKind::TooNested { limit }, id, None));
                    }
                    state[id.index()] = DONE;
                    stack.pop();
                }
            }
        }
        Ok(())
    }

    /// An error at `node`, or at the child of `node` that `step` leads to.
    fn error(
        &self,
        kind: SchemaBuildErrorKind,
        node: NodeId,
        step: Option<Step>,
    ) -> SchemaBuildError {
        let mut steps: Vec<(NodeId, Step)> = step.map(|step| (node, step)).into_iter().collect();
        let mut current = node;
        let root = loop {
            match self.origins[current.index()] {
                Origin::Child(parent, step) => {
                    steps.push((parent, step));
                    current = parent;
                }
                Origin::Root(root) => break Some(root),
                Origin::Unreached => break None,
            }
        };
        let mut path = root.map_or_else(String::new, |root| self.roots[root].0.clone());
        for &(parent, step) in steps.iter().rev() {
            match step {
                Step::Def => path.push_str("/def"),
                Step::Schema => path.push_str("/def/schema"),
                Step::Entry(position) => {
                    let key = self.nodes[parent.index()]
                        .entries()
                        .and_then(|entries| entries.keys.get(position));
                    path.push_str("/def/");
                    path.push_str(&pointer_token(key.map_or("", |key| key)));
                }
                Step::Index(index) => {
                    path.push_str("/def/");
                    path.push_str(&index.to_string());
                }
                Step::Option(index) => {
                    path.push_str("/def/options/");
                    path.push_str(&index.to_string());
                }
                Step::Key => path.push_str("/def/key"),
            }
        }
        SchemaBuildError::new(kind, path)
    }
}

/// Calls `visit` with every node `node` refers to and the step to it.
fn for_each_child(node: &SchemaNode, mut visit: impl FnMut(Step, NodeId)) {
    match node {
        SchemaNode::Optional(schema) | SchemaNode::Nullable(schema) => visit(Step::Schema, *schema),
        SchemaNode::WithDefault(default) => visit(Step::Schema, default.schema),
        SchemaNode::Lazy(schema) | SchemaNode::Record(schema) | SchemaNode::Array(schema) => {
            visit(Step::Def, *schema);
        }
        SchemaNode::Object(entries)
        | SchemaNode::LooseObject(entries)
        | SchemaNode::StripObject(entries) => {
            for (position, &schema) in entries.schemas.iter().enumerate() {
                visit(Step::Entry(position), schema);
            }
        }
        SchemaNode::Union(schemas) | SchemaNode::Pipe(schemas) => {
            for (index, &schema) in schemas.iter().enumerate() {
                visit(Step::Index(index), schema);
            }
        }
        SchemaNode::Variant(variant) => {
            for (index, &option) in variant.options.iter().enumerate() {
                visit(Step::Option(index), option);
            }
        }
        SchemaNode::String
        | SchemaNode::Number
        | SchemaNode::Boolean
        | SchemaNode::Bigint
        | SchemaNode::Unknown
        | SchemaNode::Literal(_)
        | SchemaNode::OneOf(_)
        | SchemaNode::MinLength(_)
        | SchemaNode::MaxLength(_)
        | SchemaNode::MinValue(_)
        | SchemaNode::MaxValue(_)
        | SchemaNode::Integer
        | SchemaNode::SafeInteger => {}
    }
}

/// A key as a reference token of a JSON Pointer.
pub fn pointer_token(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Adds a schema to a builder.
    type Make = fn(&mut SchemaBuilder) -> NodeId;
    /// Adds a schema around another.
    type Wrap = fn(&mut SchemaBuilder, NodeId) -> NodeId;

    fn refusal(build: impl FnOnce(&mut SchemaBuilder) -> NodeId) -> (SchemaBuildErrorKind, String) {
        let mut builder = SchemaBuilder::new();
        let root = build(&mut builder);
        let error = builder.build(root).unwrap_err();
        (error.kind().clone(), error.path().to_owned())
    }

    fn built(build: impl FnOnce(&mut SchemaBuilder) -> NodeId) -> Schema {
        let mut builder = SchemaBuilder::new();
        let root = build(&mut builder);
        builder.build(root).unwrap()
    }

    #[test]
    fn non_finite_numbers_are_refused() {
        for number in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(
                refusal(|b| b.literal(number)),
                (
                    SchemaBuildErrorKind::NonFiniteNumber,
                    "/schema/def".to_owned()
                )
            );
            assert_eq!(
                refusal(|b| b.one_of([1.0, number])),
                (
                    SchemaBuildErrorKind::NonFiniteNumber,
                    "/schema/def/1".to_owned()
                )
            );
            assert_eq!(
                refusal(|b| {
                    let head = b.number();
                    let bound = b.min_value(number);
                    b.pipe([head, bound])
                }),
                (
                    SchemaBuildErrorKind::NonFiniteNumber,
                    "/schema/def/1/def".to_owned()
                )
            );
        }
    }

    #[test]
    fn prototype_keys_are_refused() {
        for key in js::OBJECT_PROTOTYPE_KEYS {
            for kind in 0..3 {
                let (error, path) = refusal(|b| {
                    let s = b.string();
                    let entries = [("ok", s), (key, s)];
                    let object = match kind {
                        0 => b.object(entries),
                        1 => b.loose_object(entries),
                        _ => b.strip_object(entries),
                    };
                    b.array(object)
                });
                assert_eq!(
                    error,
                    SchemaBuildErrorKind::PrototypeKey { key: key.into() }
                );
                assert_eq!(path, format!("/schema/def/def/{key}"));
            }
            // a `variant` with no option reads its key off the input all the same
            let (error, path) = refusal(|b| {
                let variant = b.variant(key, []);
                b.array(variant)
            });
            assert_eq!(
                error,
                SchemaBuildErrorKind::PrototypeKey { key: key.into() }
            );
            assert_eq!(path, "/schema/def/def/key");
            // with options the key is an entry, and is refused as one
            let (error, path) = refusal(|b| {
                let literal = b.literal("a");
                let option = b.object([(key, literal)]);
                b.variant(key, [option])
            });
            assert_eq!(
                error,
                SchemaBuildErrorKind::PrototypeKey { key: key.into() }
            );
            assert_eq!(path, format!("/schema/def/options/0/def/{key}"));
        }
    }

    #[test]
    fn duplicate_keys_are_refused() {
        assert_eq!(
            refusal(|b| {
                let s = b.string();
                b.object([("a", s), ("b", s), ("a", s)])
            }),
            (
                SchemaBuildErrorKind::DuplicateKey { key: "a".into() },
                "/schema".to_owned()
            )
        );
    }

    #[test]
    fn pipes_are_checked() {
        assert_eq!(
            refusal(|b| b.pipe([])),
            (SchemaBuildErrorKind::EmptyPipe, "/schema".to_owned())
        );
        for head in [
            SchemaKind::Unknown,
            SchemaKind::Boolean,
            SchemaKind::Nullable,
            SchemaKind::MinLength,
        ] {
            let (error, path) = refusal(|b| {
                let string = b.string();
                let head = match head {
                    SchemaKind::Unknown => b.unknown(),
                    SchemaKind::Boolean => b.boolean(),
                    SchemaKind::Nullable => b.nullable(string),
                    _ => b.min_length(1.0),
                };
                b.pipe([head])
            });
            assert_eq!(error, SchemaBuildErrorKind::PipeHead { kind: head });
            assert_eq!(path, "/schema/def/0");
        }
        assert_eq!(
            refusal(|b| {
                let string = b.string();
                let again = b.string();
                b.pipe([string, again])
            }),
            (
                SchemaBuildErrorKind::PipeStep {
                    kind: SchemaKind::String
                },
                "/schema/def/1".to_owned()
            )
        );
        let mismatches: [(Make, Make, SchemaKind); 6] = [
            (
                SchemaBuilder::string,
                |b| b.min_value(0.0),
                SchemaKind::MinValue,
            ),
            (
                SchemaBuilder::string,
                SchemaBuilder::integer,
                SchemaKind::Integer,
            ),
            (
                SchemaBuilder::number,
                |b| b.max_length(1.0),
                SchemaKind::MaxLength,
            ),
            (
                SchemaBuilder::integer,
                |b| b.min_length(1.0),
                SchemaKind::MinLength,
            ),
            (
                |b| {
                    let item = b.string();
                    b.array(item)
                },
                SchemaBuilder::safe_integer,
                SchemaKind::SafeInteger,
            ),
            (
                |b| {
                    let item = b.string();
                    b.array(item)
                },
                |b| b.max_value(1.0),
                SchemaKind::MaxValue,
            ),
        ];
        for (head, action, kind) in mismatches {
            let (error, path) = refusal(|b| {
                let head = head(b);
                let ok = match b.nodes[head.index()].kind() {
                    SchemaKind::String | SchemaKind::Array => b.min_length(0.0),
                    _ => b.integer(),
                };
                let action = action(b);
                b.pipe([head, ok, action])
            });
            assert_eq!(error, SchemaBuildErrorKind::ActionMismatch { kind });
            assert_eq!(path, "/schema/def/2");
        }
    }

    #[test]
    fn a_pipe_can_start_with_a_pipe_or_a_number_test() {
        built(|b| {
            let string = b.string();
            let min = b.min_length(1.0);
            let inner = b.pipe([string, min]);
            let max = b.max_length(5.0);
            b.pipe([inner, max])
        });
        built(|b| {
            let integer = b.integer();
            let min = b.min_value(0.0);
            b.pipe([integer, min])
        });
        built(|b| {
            let item = b.safe_integer();
            b.array(item)
        });
    }

    #[test]
    fn bounds_outside_a_pipe_are_refused() {
        let actions: [(Make, SchemaKind); 4] = [
            (|b| b.min_length(1.0), SchemaKind::MinLength),
            (|b| b.max_length(1.0), SchemaKind::MaxLength),
            (|b| b.min_value(1.0), SchemaKind::MinValue),
            (|b| b.max_value(1.0), SchemaKind::MaxValue),
        ];
        for (action, kind) in actions {
            let expected = SchemaBuildErrorKind::ActionOutsidePipe { kind };
            assert_eq!(refusal(action), (expected.clone(), "/schema".to_owned()));
            let parents: [(Wrap, &str); 9] = [
                (|b, a| b.optional(a), "/schema/def/schema"),
                (|b, a| b.nullable(a), "/schema/def/schema"),
                (|b, a| b.with_default(a, Json::Null), "/schema/def/schema"),
                (|b, a| b.array(a), "/schema/def"),
                (|b, a| b.record(a), "/schema/def"),
                (|b, a| b.object([("a/b~c", a)]), "/schema/def/a~1b~0c"),
                (|b, a| b.loose_object([("x", a)]), "/schema/def/x"),
                (
                    |b, a| {
                        let s = b.string();
                        b.union([s, a])
                    },
                    "/schema/def/1",
                ),
                (
                    |b, a| {
                        let lazy = b.declare();
                        b.define(lazy, a);
                        lazy
                    },
                    "/defs/$0",
                ),
            ];
            for (parent, path) in parents {
                assert_eq!(
                    refusal(|b| {
                        let action = action(b);
                        parent(b, action)
                    }),
                    (expected.clone(), path.to_owned())
                );
            }
        }
    }

    #[test]
    fn variants_are_checked() {
        assert_eq!(
            refusal(|b| {
                let a = b.literal("a");
                let object = b.object([("k", a)]);
                let string = b.string();
                b.variant("k", [object, string])
            }),
            (
                SchemaBuildErrorKind::VariantOption {
                    kind: SchemaKind::String
                },
                "/schema/def/options/1".to_owned()
            )
        );
        let options: [Make; 4] = [
            |b| b.object::<&str>([]),
            |b| {
                let s = b.string();
                b.object([("k", s)])
            },
            |b| {
                let a = b.literal("a");
                let optional = b.optional(a);
                b.object([("k", optional)])
            },
            |b| {
                let a = b.literal("a");
                b.object([("other", a)])
            },
        ];
        for build in options {
            assert_eq!(
                refusal(|b| {
                    let option = build(b);
                    b.variant("k", [option])
                }),
                (
                    SchemaBuildErrorKind::VariantDiscriminator { key: "k".into() },
                    "/schema/def/options/0".to_owned()
                )
            );
        }
        // no options never matches, and is not refused
        built(|b| b.variant("k", []));
    }

    #[test]
    fn lazies_are_checked() {
        assert_eq!(
            refusal(|b| {
                let lazy = b.declare();
                b.array(lazy)
            }),
            (
                SchemaBuildErrorKind::UndefinedLazy,
                "/schema/def".to_owned()
            )
        );
        assert_eq!(
            refusal(|b| {
                let lazy = b.declare();
                let s = b.string();
                b.define(lazy, s);
                b.define(lazy, s);
                lazy
            }),
            (SchemaBuildErrorKind::RedefinedLazy, String::new())
        );
        assert_eq!(
            refusal(|b| {
                let s = b.string();
                b.define(s, s);
                s
            }),
            (SchemaBuildErrorKind::InvalidNode, String::new())
        );
        // a lazy never used and never defined is out of reach
        built(|b| {
            b.declare();
            b.string()
        });
    }

    #[test]
    fn foreign_ids_are_refused() {
        let mut other = SchemaBuilder::new();
        for _ in 0..5 {
            other.string();
        }
        let foreign = other.string();
        assert_eq!(
            refusal(|_| foreign),
            (SchemaBuildErrorKind::InvalidNode, "/schema".to_owned())
        );
        assert_eq!(
            refusal(|b| b.array(foreign)),
            (SchemaBuildErrorKind::InvalidNode, "/schema/def".to_owned())
        );
        // in range, and not made before the node that uses it
        assert_eq!(
            refusal(|b| {
                let array = b.array(foreign);
                for _ in 0..8 {
                    b.string();
                }
                array
            }),
            (SchemaBuildErrorKind::InvalidNode, "/schema/def".to_owned())
        );
        assert_eq!(
            refusal(|b| {
                let lazy = b.declare();
                b.define(lazy, foreign);
                lazy
            }),
            (SchemaBuildErrorKind::InvalidNode, "/defs/$0".to_owned())
        );
    }

    #[test]
    fn unguarded_recursion_is_refused() {
        let cycles: [Wrap; 6] = [
            |_, lazy| lazy,
            |b, lazy| b.optional(lazy),
            |b, lazy| b.nullable(lazy),
            |b, lazy| b.with_default(lazy, Json::Null),
            |b, lazy| {
                let s = b.string();
                b.union([s, lazy])
            },
            |b, lazy| {
                let other = b.declare();
                b.define(other, lazy);
                b.nullable(other)
            },
        ];
        for cycle in cycles {
            let (error, _) = refusal(|b| {
                let lazy = b.declare();
                let target = cycle(b, lazy);
                b.define(lazy, target);
                b.array(lazy)
            });
            assert_eq!(error, SchemaBuildErrorKind::UnguardedRecursion);
        }
        assert_eq!(
            refusal(|b| {
                let lazy = b.declare();
                let optional = b.optional(lazy);
                b.define(lazy, optional);
                lazy
            }),
            (
                SchemaBuildErrorKind::UnguardedRecursion,
                "/schema".to_owned()
            )
        );
    }

    #[test]
    fn recursion_through_a_container_is_guarded() {
        let guards: [Wrap; 5] = [
            |b, lazy| b.array(lazy),
            |b, lazy| b.record(lazy),
            |b, lazy| b.object([("next", lazy)]),
            |b, lazy| {
                let optional = b.optional(lazy);
                b.loose_object([("next", optional)])
            },
            |b, lazy| {
                let tag = b.literal("t");
                let option = b.strip_object([("tag", tag), ("next", lazy)]);
                b.variant("tag", [option])
            },
        ];
        for guard in guards {
            built(|b| {
                let lazy = b.declare();
                let container = guard(b, lazy);
                let null = b.literal(SchemaLiteral::Null);
                let either = b.union([null, container]);
                b.define(lazy, either);
                lazy
            });
        }
    }

    #[test]
    fn nesting_has_a_limit() {
        let nested = |depth: usize| {
            move |b: &mut SchemaBuilder| {
                let mut id = b.string();
                for _ in 0..depth {
                    id = b.optional(id);
                }
                id
            }
        };
        built(nested(MAX_NESTING));
        assert_eq!(
            refusal(nested(MAX_NESTING + 1)),
            (
                SchemaBuildErrorKind::TooNested { limit: MAX_NESTING },
                "/schema".to_owned()
            )
        );
        // a container between them starts the count again
        built(|b| {
            let inner = nested(MAX_NESTING)(b);
            let mut id = b.array(inner);
            for _ in 0..MAX_NESTING {
                id = b.nullable(id);
            }
            id
        });
        // and so does each lazy only when it is behind a container
        assert_eq!(
            refusal(|b| {
                let inner = nested(MAX_NESTING)(b);
                let lazy = b.declare();
                b.define(lazy, inner);
                b.array(lazy)
            }),
            (
                SchemaBuildErrorKind::TooNested { limit: MAX_NESTING },
                "/schema/def".to_owned()
            )
        );
    }

    #[test]
    fn unreachable_nodes_are_not_checked() {
        built(|b| {
            b.pipe([]);
            b.literal(f64::NAN);
            b.string()
        });
    }

    #[test]
    fn pointer_tokens_escape_their_two_characters() {
        assert_eq!(pointer_token("a/b~c"), "a~1b~0c");
        assert_eq!(pointer_token("~1"), "~01");
        assert_eq!(pointer_token(""), "");
    }
}
