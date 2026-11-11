/**
 * The exports of `schema.ts` and `meta.ts` that are a schema or make one, read
 * by the TypeScript compiler: what `schema.emit.test.ts` holds to a named type
 * and `schema.invariants.test.ts` holds to the annotation a bundler drops an
 * unused call by.
 *
 * @module
 */

import { assert } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));

/** The library's modules that export schemas and the factories of them. */
export const SCHEMA_EXPORT_PATHS: ReadonlyArray<string> = [
	join(dir, '../lib/schema.ts'),
	join(dir, '../lib/meta.ts')
];

/** An export that is a schema, or one call signature of an export that returns one. */
export interface SchemaExport {
	/** The name it is exported by. */
	name: string;
	/** Whether it is called to make the schema, and is not one itself. */
	factory: boolean;
	/** The type it declares, of the schema or of what the signature returns. */
	node: ts.TypeNode | undefined;
	/** The statement that declares it. */
	statement: ts.Statement;
}

/**
 * Every export of `SCHEMA_EXPORT_PATHS` that is a schema, as its type has a
 * `kind`, a `def`, and a `run`, and every call signature of one whose return
 * type is.
 */
export const get_schema_exports = (program: ts.Program): Array<SchemaExport> => {
	const checker = program.getTypeChecker();
	const is_schema_type = (type: ts.Type): boolean => {
		const apparent = checker.getApparentType(type);
		return ['kind', 'def', 'run'].every((p) => apparent.getProperty(p) !== undefined);
	};
	const found: Array<SchemaExport> = [];
	for (const path of SCHEMA_EXPORT_PATHS) {
		const module_symbol = checker.getSymbolAtLocation(program.getSourceFile(path)!)!;
		for (const exported of checker.getExportsOfModule(module_symbol)) {
			// `void` is exported as an alias of `void_`
			const symbol =
				exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
			const declaration = symbol.valueDeclaration;
			if (!declaration) continue;
			const { name } = exported;
			const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
			const add = (node: ts.TypeNode | undefined, of: ts.Type, factory: boolean): void => {
				if (!is_schema_type(of)) return;
				let statement: ts.Node = declaration;
				while (!ts.isSourceFile(statement.parent)) statement = statement.parent;
				found.push({ name, factory, node, statement: statement as ts.Statement });
			};
			// each call signature of a factory, by the return type it declares
			const add_signatures = (): void => {
				for (const signature of type.getCallSignatures()) {
					const signature_declaration = signature.getDeclaration() as
						ts.SignatureDeclaration | undefined;
					add(signature_declaration?.type, signature.getReturnType(), true);
				}
			};
			if (ts.isFunctionDeclaration(declaration)) add_signatures();
			else if (!ts.isVariableDeclaration(declaration)) continue;
			else if (type.getCallSignatures().length) {
				if (declaration.type) add_signatures();
				else {
					// an arrow function, typed by its own return annotation
					const init = declaration.initializer;
					assert(init && ts.isArrowFunction(init), `${name}: no declared type`);
					add(init.type, type.getCallSignatures()[0]!.getReturnType(), true);
				}
			} else add(declaration.type, type, false);
		}
	}
	return found;
};
