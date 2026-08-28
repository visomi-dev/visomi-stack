export type ComponentCatalogEntry = {
  name: string;
  selector: string;
  filePath: string;
  templatePath: string | null;
  stylePath: string | null;
  hasSpec: boolean;
  controlValueAccessor: boolean;
  inputs: { name: string; required: boolean; default: string | null; type: 'input' | 'model' }[];
  outputs: { name: string; type: 'output' }[];
};

export type ComponentCatalog = {
  components: ComponentCatalogEntry[];
};
