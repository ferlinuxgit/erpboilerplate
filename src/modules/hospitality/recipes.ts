/**
 * Escandallos: qué ingredientes lleva cada plato, cuánto cuesta y qué sale del almacén al venderlo.
 * Admite sub-recetas (una salsa usada en varios platos) hasta 4 niveles y nunca entra en bucle.
 */

export type RecipeBook = ReadonlyMap<string, ReadonlyArray<{ ingredientItemId: string; quantity: number }>>;

const MAX_DEPTH = 4;
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** Cambia cada plato con escandallo por sus ingredientes (los que no tienen, se quedan igual). */
export function expandRecipes(lines: ReadonlyArray<{ itemId: string; quantity: number }>, recipes: RecipeBook) {
  const totals = new Map<string, number>();
  const visit = (itemId: string, quantity: number, depth: number, path: ReadonlySet<string>) => {
    const recipe = recipes.get(itemId);
    if (!recipe || recipe.length === 0 || depth >= MAX_DEPTH || path.has(itemId)) {
      totals.set(itemId, round4((totals.get(itemId) ?? 0) + quantity));
      return;
    }
    const next = new Set(path).add(itemId);
    for (const line of recipe) visit(line.ingredientItemId, quantity * line.quantity, depth + 1, next);
  };
  for (const line of lines) visit(line.itemId, line.quantity, 0, new Set());
  return totals;
}

/** ¿Añadir este ingrediente crearía un bucle (el plato acabaría conteniéndose a sí mismo)? */
export function createsCycle(itemId: string, ingredientIds: readonly string[], recipes: RecipeBook) {
  const stack = [...ingredientIds];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === itemId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const line of recipes.get(current) ?? []) stack.push(line.ingredientItemId);
  }
  return false;
}

/** Coste de una ración: suma de ingredientes × su coste (sub-recetas incluidas). */
export function recipeCost(itemId: string, recipes: RecipeBook, unitCost: (itemId: string) => number) {
  const ingredients = expandRecipes([{ itemId, quantity: 1 }], recipes);
  let total = 0;
  for (const [ingredientId, quantity] of ingredients) total += quantity * unitCost(ingredientId);
  return Math.round(total * 100) / 100;
}

/** Food cost: % del precio sin IVA que se va en ingredientes, y su semáforo habitual en hostelería. */
export function foodCost(cost: number, netPrice: number) {
  if (netPrice <= 0) return { percent: null, tone: "neutral" as const };
  const percent = Math.round((cost / netPrice) * 1000) / 10;
  return { percent, tone: percent <= 30 ? ("good" as const) : percent <= 35 ? ("warning" as const) : ("bad" as const) };
}
