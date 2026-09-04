type Primitive = bigint | boolean | null | number | string | symbol | undefined;

export type DeepReadonly<Value> = Value extends Primitive
  ? Value
  : Value extends (...arguments_: never[]) => unknown
    ? Value
    : Value extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
      : Value extends object
        ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
        : Value;
