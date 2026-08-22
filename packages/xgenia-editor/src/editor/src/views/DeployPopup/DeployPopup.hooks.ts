import { ICloudService } from '@xgenia-models/CloudServices';

import { getRgsSettings } from '@xgenia-utils/rgs/rgsClient';
import { NO_ENVIRONMENT_VALUE, RGS_ENVIRONMENT_VALUE } from './DeployPopup.constants';

/**
 * No caching, enjoy!
 *
 * @param cloudService
 * @returns
 */
export function useEnvironmentsAsOptions(
  cloudService: ICloudService,
  opts?: { alwaysIncludeRgs?: boolean }
) {
  const options = [{ label: 'No cloud service', value: NO_ENVIRONMENT_VALUE }];

  // XGENIA RGS is connected separately (Maths RGS panel), not via
  // cloudService.backend. Offer it whenever an operator key is present, or
  // always when the caller opts in (the Vercel deploy tab does, so the user can
  // pick it and get a clear "connect first" error when no key is set).
  try {
    if (opts?.alwaysIncludeRgs || getRgsSettings()?.apiKey) {
      options.push({ label: 'XGENIA RGS', value: RGS_ENVIRONMENT_VALUE });
    }
  } catch {
    /* ignore */
  }

  if (cloudService.backend.items?.length) {
    cloudService.backend.items.forEach((env) => {
      options.push({ label: env.name, value: env.id });
    });
  }

  return options;
}
