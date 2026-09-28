export interface DecodedValue {
  type: string;
  name?: string;
  value: any; // can contain nested DecodedValues
}
