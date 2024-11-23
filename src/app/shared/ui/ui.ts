import type { IconName } from './icon/paths';

export type ColorName =
  | 'BLUE'
  | 'PINK'
  | 'PURPLE'
  | 'GREEN'
  | 'YELLOW'
  | 'CUSTOM';

export type Color = {
  name: ColorName;
  value?: string;
};

export type MenuItem = {
  icon: IconName;
  iconClass?: string;
  label: string;
  link: string;
  extraClass?: string;
  queryParams?: Record<string, string>;
};

export type SelectOption = {
  label: string;
  value: string;
};

export type RadioOption = {
  label: string;
  value: string;
};
