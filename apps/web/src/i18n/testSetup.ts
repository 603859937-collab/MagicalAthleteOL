import { beforeEach } from "vitest";

import i18n from "./index";

// Game text is authored in English and translated to Chinese, so most suites assert
// the Chinese wording. Pin it here instead of repeating the switch in every file.
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});
