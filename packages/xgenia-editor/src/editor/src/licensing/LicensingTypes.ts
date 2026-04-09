// xgenia-editor/src/editor/src/licensing/LicensingTypes.ts

export interface LicenseData {
    machineIds: string[];
    // maybe you store subscription type, licenseLevel, expiration, etc
    licenseLevel?: string;
    expirationDate?: string;
}
