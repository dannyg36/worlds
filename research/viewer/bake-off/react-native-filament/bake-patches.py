import re, pathlib

def patch(path, subs):
    p = pathlib.Path(path)
    s = p.read_text()
    for old, new in subs:
        assert old in s, (path, old)
        s = s.replace(old, new)
    p.write_text(s)

patch("node_modules/react-native-worklets-core/ios/Worklets.mm", [
    ("@implementation Worklets\n", "@interface RCTBridge (WKTRuntimeAccess)\n- (void *)runtime;\n- (std::shared_ptr<facebook::react::CallInvoker>)jsCallInvoker;\n@end\n\n@implementation Worklets\n"),
    ("RCTCxxBridge *cxxBridge = (RCTCxxBridge *)_bridge;", "RCTBridge *cxxBridge = _bridge;"),
])

patch("node_modules/react-native-filament/ios/src/RNFFilamentModule.mm", [
    ("- (std::shared_ptr<react::CallInvoker>)jsCallInvoker;\n@end\n", "- (std::shared_ptr<react::CallInvoker>)jsCallInvoker;\n- (RCTSurfacePresenter*)surfacePresenter;\n@end\n"),
    ("RCTCxxBridge* cxxBridge = (RCTCxxBridge*)self.bridge;", "RCTBridge* cxxBridge = self.bridge;"),
])

patch("node_modules/react-native-filament/ios/src/RNFFilamentInstaller.mm", [
    ("@interface RCTCxxBridge (CallInvoker)", "@interface RCTBridge (CallInvoker)"),
])

patch("node_modules/react-native-filament/src/utilities/withCleanupScope.ts", [
    ("import { InteractionManager } from 'react-native'\n", ""),
    ("InteractionManager.runAfterInteractions(() => {", "((cb: () => void) => setTimeout(cb, 0))(() => {"),
])
