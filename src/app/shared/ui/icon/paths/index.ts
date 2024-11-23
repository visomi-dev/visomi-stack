import { paths as chevronLeft } from './chevron-left';
import { paths as chevronRight } from './chevron-right';
import { paths as chevronDown } from './chevron-down';
import { paths as plus } from './plus';
import { paths as close } from './close';
import { paths as logout } from './logout';
import { paths as chartPie } from './chart-pie';
import { paths as menu } from './menu';
import { paths as eye } from './eye';
import { paths as eyeOff } from './eye-off';
import { paths as check } from './check';
import { paths as phone } from './phone';
import { paths as chatBubbleBottomCenterText } from './chat-bubble-bottom-center-text';
import { paths as users } from './users';
import { paths as adjustmentsVertical } from './adjustments-vertical';
import { paths as magnifyingGlass } from './magnifying-glass';
import { paths as user } from './user';
import { paths as checkCircle } from './check-circle';
import { paths as exclamationCircle } from './exclamation-circle';
import { paths as exclamationTriangle } from './exclamation-triangle';
import { paths as pencil } from './pencil';
import { paths as devicePhoneMobile } from './device-phone-mobile';
import { paths as microphoneSlash } from './microphone-slash';
import { paths as rectangleGroup } from './rectangle-group';
import { paths as trash } from './trash';
import { paths as arrowTopRightOnSquare } from './arrow-top-right-on-square';
import { paths as pause } from './pause';
import { paths as speakerWave } from './speaker-wave';
import { paths as phoneArrowUpRight } from './phone-arrow-up-right';
import { paths as chevronDoubleLeft } from './chevron-double-left';
import { paths as chevronDoubleRight } from './chevron-double-right';
import { paths as chartBar } from './chart-bar';
import { paths as chevronUpDown } from './chevron-up-down';
import { paths as arrowRight } from './arrow-right';
import { paths as play } from './play';
import { paths as rocketLaunch } from './rocket-launch';
import { paths as bankNotes } from './bank-notes';
import { paths as calculator } from './calculator';
import { paths as wifiOff } from './wifi-off';
import { paths as shieldCheck } from './shield-check';
import { paths as share } from './share';
import { paths as questionMarkCircle } from './question-mark-circle';
import { paths as floppyDisk } from './floppy-disk';
import { paths as bookOpen } from './book-open';
import { paths as home } from './home';

export const paths = {
  'chevron-left': chevronLeft,
  'chevron-right': chevronRight,
  'chevron-down': chevronDown,
  plus,
  close,
  logout,
  'chart-pie': chartPie,
  menu,
  eye,
  'eye-off': eyeOff,
  check,
  phone,
  'chat-bubble-bottom-center-text': chatBubbleBottomCenterText,
  users,
  'adjustments-vertical': adjustmentsVertical,
  'magnifying-glass': magnifyingGlass,
  user,
  'check-circle': checkCircle,
  'exclamation-circle': exclamationCircle,
  'exclamation-triangle': exclamationTriangle,
  pencil,
  'device-phone-mobile': devicePhoneMobile,
  'microphone-slash': microphoneSlash,
  'rectangle-group': rectangleGroup,
  trash,
  'arrow-top-right-on-square': arrowTopRightOnSquare,
  pause,
  'speaker-wave': speakerWave,
  'phone-arrow-up-right': phoneArrowUpRight,
  'chevron-double-left': chevronDoubleLeft,
  'chevron-double-right': chevronDoubleRight,
  'chart-bar': chartBar,
  'chevron-up-down': chevronUpDown,
  'arrow-right': arrowRight,
  play,
  'rocket-launch': rocketLaunch,
  'bank-notes': bankNotes,
  calculator,
  'wifi-off': wifiOff,
  'shield-check': shieldCheck,
  share,
  'question-mark-circle': questionMarkCircle,
  'floppy-disk': floppyDisk,
  'book-open': bookOpen,
  home,
};

export type IconName = keyof typeof paths;
