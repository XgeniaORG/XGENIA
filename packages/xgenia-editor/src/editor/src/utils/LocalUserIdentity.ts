export class LocalUserIdentity {
    private static _user = {
        name: 'Local',
        id: 'local',
        email: '',
    };

    public static getUserInfo() {
        return this._user;
    }

    // ADD THIS:
    public static setUserInfo(user: { name: string; id: string; email: string }) {
        this._user = user;
    }
}
