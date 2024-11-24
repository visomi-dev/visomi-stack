import { AppAbility } from '../casl-ability.factory';

type IPolicyHandler = {
  handle(ability: AppAbility): boolean;
};

type PolicyHandlerCallback = (ability: AppAbility) => boolean;

export type PolicyHandler = IPolicyHandler | PolicyHandlerCallback;
