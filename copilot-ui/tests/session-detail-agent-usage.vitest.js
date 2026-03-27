"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var react_1 = require("@testing-library/react");
var vitest_1 = require("vitest");
var mockGetSessionAgentUsage = vitest_1.vi.fn();
var mockGetCatalogAssetAnalytics = vitest_1.vi.fn();
var mockGetSessionHandoff = vitest_1.vi.fn();
var mockGetSessionProposition = vitest_1.vi.fn();
var mockGetSessionStructuredState = vitest_1.vi.fn();
var mockGetSessionVerificationGuide = vitest_1.vi.fn();
var mockListSessionPlans = vitest_1.vi.fn();
vitest_1.vi.mock('../ui/src/lib/api', function () { return ({
    ApiError: /** @class */ (function (_super) {
        __extends(ApiError, _super);
        function ApiError(message, status) {
            var _this = _super.call(this, message) || this;
            _this.status = status;
            return _this;
        }
        return ApiError;
    }(Error)),
    getSessionAgentUsage: mockGetSessionAgentUsage,
    getCatalogAssetAnalytics: mockGetCatalogAssetAnalytics,
    getSessionHandoff: mockGetSessionHandoff,
    getSessionProposition: mockGetSessionProposition,
    getSessionStructuredState: mockGetSessionStructuredState,
    getSessionVerificationGuide: mockGetSessionVerificationGuide,
    listSessionPlans: mockListSessionPlans,
}); });
(0, vitest_1.describe)('SessionDetail agent usage', function () {
    (0, vitest_1.afterEach)(function () {
        vitest_1.vi.useRealTimers();
    });
    (0, vitest_1.beforeEach)(function () {
        vitest_1.vi.useRealTimers();
        mockGetSessionAgentUsage.mockReset();
        mockGetCatalogAssetAnalytics.mockReset();
        mockGetSessionHandoff.mockReset();
        mockGetSessionProposition.mockReset();
        mockGetSessionStructuredState.mockReset();
        mockGetSessionVerificationGuide.mockReset();
        mockListSessionPlans.mockReset();
        mockGetSessionAgentUsage.mockResolvedValue({
            id: 'session-usage-1',
            source: 'cli',
            usage: {
                'o-planner': 3,
                search: 1,
            },
            skillUsage: {
                totalInvocations: 1,
                uniqueSkillCount: 1,
                skills: [
                    {
                        assetId: 'skill-react-query',
                        assetKey: 'react-query',
                        invocationCount: 1,
                        lastInvokedAt: '2026-03-09T00:02:00.000Z',
                        toolNames: ['react-query'],
                    },
                ],
            },
        });
        mockGetCatalogAssetAnalytics.mockResolvedValue({
            analytics: {
                assets: [
                    {
                        assetId: 'skill-react-query',
                        assetKey: 'react-query',
                        kind: 'skill',
                        search: {
                            sampled: {
                                resultCount: 2,
                                selectedCount: 1,
                            },
                        },
                        usage: {
                            invocationCount: 2,
                            explicitInvocationCount: 1,
                            proxyInvocationCount: 1,
                        },
                    },
                    {
                        assetId: 'skill-proxy-only-helper',
                        assetKey: 'proxy-only-helper',
                        kind: 'skill',
                        search: {
                            sampled: {
                                resultCount: 1,
                            },
                        },
                        usage: {
                            invocationCount: 1,
                            explicitInvocationCount: 0,
                            proxyInvocationCount: 1,
                        },
                    },
                ],
                sessions: [
                    {
                        sessionId: 'session-usage-1',
                        search: {
                            queryCount: 3,
                            selectedCount: 1,
                        },
                        usage: {
                            invocationCount: 3,
                            explicitInvocationCount: 1,
                            proxyInvocationCount: 2,
                        },
                    },
                ],
                repos: [],
                recentEvents: [],
            },
        });
        mockGetSessionHandoff.mockResolvedValue({
            id: 'session-usage-1',
            source: 'cli',
            content: '## Handoff Manifest\n- Session: session-usage-1\n',
        });
        mockGetSessionProposition.mockResolvedValue({
            id: 'session-usage-1',
            source: 'cli',
            content: '## 2026-03-23T00:00:00Z — after-execution — workflow-executor\n',
            entries: [
                {
                    heading: '2026-03-23T00:00:00Z — after-execution — workflow-executor',
                    phase: 'after-execution',
                    sections: [],
                },
            ],
        });
        mockGetSessionStructuredState.mockResolvedValue({
            id: 'session-usage-1',
            source: 'cli',
            warnings: [],
            nextUnit: null,
            meta: {
                intentFrame: {
                    summary: 'Focus the session details view on the derived Session Intent Frame first.',
                    inScope: ['Render the framing card before raw artifacts.'],
                    outOfScope: ['Broader planning-surface rollout remains later.'],
                    successSignals: ['Session Intent Frame appears at the top of the artifacts area.'],
                    constraints: ['Do not add new required artifact files.'],
                    watchOuts: ['Keep raw artifacts available as supporting detail.'],
                    sourceArtifacts: ['plan', 'handoff', 'proposition'],
                },
                closureSummary: {
                    summary: 'The runtime/UI adoption slice is implemented and exposed through structured-state.',
                    outcome: 'completed',
                    confidence: 'high',
                    reviewVerdict: 'APPROVED',
                    delivered: ['Structured-state publishes intent and closure summaries.'],
                    validationEvidence: ['Review ledger verdict: APPROVED (reviewer-opus-4-6)'],
                    followUps: {
                        activeContinuation: ['Verify the framing cards in Session Details.'],
                        durableCarryover: ['Extend the same summaries into planning surfaces later.'],
                    },
                    sourceArtifacts: ['plan', 'proposition', 'verification-guide'],
                },
                executionOverlay: {
                    present: true,
                    applied: true,
                    warnings: [],
                },
                executionState: {
                    schemaVersion: 'execution-state-v1',
                    updatedAt: '2026-03-23T00:01:00.000Z',
                    lifecycle: 'executing',
                    status: 'active',
                    mode: 'resumed',
                    summary: 'The orchestrator is actively working through the runtime overlay tree.',
                    activeGroup: {
                        id: 'G-01',
                        label: 'Runtime Adoption',
                        status: 'in-progress',
                    },
                    activeWorkUnit: {
                        id: 'WU-002',
                        label: 'Merge execution overlay',
                        status: 'in-progress',
                    },
                    nextUnit: {
                        workUnitId: 'WU-003',
                        rationale: 'Render the Session Detail execution hierarchy.',
                    },
                    lastCompletedUnit: {
                        id: 'WU-001',
                        label: 'Contract definition',
                        status: 'done',
                    },
                    blockers: [
                        {
                            label: 'Keep test routing narrow',
                            details: 'Request broader coverage instead of running it here.',
                            severity: 'medium',
                        },
                    ],
                    replanCount: 1,
                    tree: [
                        {
                            id: 'G-01',
                            kind: 'group',
                            label: 'Runtime Adoption',
                            status: 'in-progress',
                            current: true,
                            children: [
                                {
                                    id: 'WU-001',
                                    kind: 'work-unit',
                                    label: 'Contract definition',
                                    status: 'done',
                                },
                                {
                                    id: 'WU-002',
                                    kind: 'work-unit',
                                    label: 'Merge execution overlay',
                                    status: 'in-progress',
                                    current: true,
                                },
                                {
                                    id: 'WU-003',
                                    kind: 'work-unit',
                                    label: 'Render execution tree',
                                    status: 'queued',
                                    next: true,
                                },
                            ],
                        },
                    ],
                },
            },
        });
        mockGetSessionVerificationGuide.mockResolvedValue({
            id: 'session-usage-1',
            source: 'cli',
            content: '## Summary\nVerify the framing cards.\n',
        });
        mockListSessionPlans.mockResolvedValue({
            id: 'session-usage-1',
            source: 'cli',
            plans: [],
        });
    });
    (0, vitest_1.it)('renders bounded sampled agent usage for the selected session', function () { return __awaiter(void 0, void 0, void 0, function () {
        var SessionDetail;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, Promise.resolve().then(function () { return require('../ui/src/tabs/Sessions/SessionDetail'); })];
                case 1:
                    SessionDetail = (_a.sent()).default;
                    (0, react_1.render)(<SessionDetail session={{
                            id: 'session-usage-1',
                            source: 'cli',
                            status: 'idle',
                        }}/>);
                    return [4 /*yield*/, (0, react_1.waitFor)(function () {
                            (0, vitest_1.expect)(react_1.screen.getByText(/Observed agent \/ planner usage/i)).toBeInTheDocument();
                        })];
                case 2:
                    _a.sent();
                    (0, vitest_1.expect)(react_1.screen.getByText(/bounded sample rather than a full historical ledger/i)).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByText(/Sampled invocations:/i)).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByText(/O Planner/i)).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getAllByText(/Search/i).length).toBeGreaterThan(0);
                    (0, vitest_1.expect)(react_1.screen.getByText('Session Intent Frame')).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByText(/derived Session Intent Frame first/i)).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByText('Execution State')).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByText(/actively working through the runtime overlay tree/i)).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByText('Execution tree')).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByText(/Merge execution overlay/i)).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByText(/Keep test routing narrow/i)).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByText('Session Closure Summary')).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByText(/runtime\/UI adoption slice is implemented/i)).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByText('Supporting raw artifacts')).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByText(/Observed skill usage/i)).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByText(/^Session rollup:$/i).parentElement).toHaveTextContent('Session rollup: Searched 3 · Selected 1 · Invoked 3');
                    (0, vitest_1.expect)(react_1.screen.getByText(/React Query/i)).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByText(/Proxy Only Helper/i)).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getAllByText(/proxy-only fallback/i).length).toBeGreaterThan(0);
                    (0, vitest_1.expect)(mockGetSessionAgentUsage).toHaveBeenCalledWith('session-usage-1', { source: 'cli', limit: 500 });
                    (0, vitest_1.expect)(mockGetCatalogAssetAnalytics).toHaveBeenCalledWith({ sessionId: 'session-usage-1', limit: 500 });
                    return [2 /*return*/];
            }
        });
    }); });
    (0, vitest_1.it)('polls structured session artifacts while the selected session remains active', function () { return __awaiter(void 0, void 0, void 0, function () {
        var SessionDetail;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    vitest_1.vi.useFakeTimers();
                    mockGetSessionStructuredState
                        .mockResolvedValueOnce({
                        id: 'session-usage-1',
                        source: 'cli',
                        warnings: [],
                        nextUnit: null,
                        meta: {
                            executionOverlay: {
                                present: true,
                                applied: true,
                                warnings: [],
                            },
                            executionState: {
                                schemaVersion: 'execution-state-v1',
                                summary: 'Initial execution snapshot.',
                                status: 'active',
                            },
                        },
                    })
                        .mockResolvedValueOnce({
                        id: 'session-usage-1',
                        source: 'cli',
                        warnings: [],
                        nextUnit: null,
                        meta: {
                            executionOverlay: {
                                present: true,
                                applied: true,
                                warnings: [],
                            },
                            executionState: {
                                schemaVersion: 'execution-state-v1',
                                summary: 'Updated execution snapshot.',
                                status: 'active',
                            },
                        },
                    });
                    return [4 /*yield*/, Promise.resolve().then(function () { return require('../ui/src/tabs/Sessions/SessionDetail'); })];
                case 1:
                    SessionDetail = (_a.sent()).default;
                    (0, react_1.render)(<SessionDetail session={{
                            id: 'session-usage-1',
                            source: 'cli',
                            active: true,
                            status: 'active',
                        }}/>);
                    return [4 /*yield*/, (0, react_1.waitFor)(function () {
                            (0, vitest_1.expect)(react_1.screen.getByText(/Initial execution snapshot\./i)).toBeInTheDocument();
                        })];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, (0, react_1.act)(function () { return __awaiter(void 0, void 0, void 0, function () {
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, vitest_1.vi.advanceTimersByTimeAsync(5000)];
                                    case 1:
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); })];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, (0, react_1.waitFor)(function () {
                            (0, vitest_1.expect)(react_1.screen.getByText(/Updated execution snapshot\./i)).toBeInTheDocument();
                        })];
                case 4:
                    _a.sent();
                    (0, vitest_1.expect)(mockGetSessionStructuredState).toHaveBeenCalledTimes(2);
                    return [2 /*return*/];
            }
        });
    }); });
    (0, vitest_1.it)('keeps structured state visible when ancillary artifact reads fail', function () { return __awaiter(void 0, void 0, void 0, function () {
        var SessionDetail;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    mockGetSessionProposition.mockRejectedValueOnce(new Error('Proposition service unavailable'));
                    return [4 /*yield*/, Promise.resolve().then(function () { return require('../ui/src/tabs/Sessions/SessionDetail'); })];
                case 1:
                    SessionDetail = (_a.sent()).default;
                    (0, react_1.render)(<SessionDetail session={{
                            id: 'session-usage-1',
                            source: 'cli',
                            status: 'idle',
                        }}/>);
                    return [4 /*yield*/, (0, react_1.waitFor)(function () {
                            (0, vitest_1.expect)(react_1.screen.getByText('Execution State')).toBeInTheDocument();
                        })];
                case 2:
                    _a.sent();
                    (0, vitest_1.expect)(react_1.screen.getByText(/actively working through the runtime overlay tree/i)).toBeInTheDocument();
                    (0, vitest_1.expect)(react_1.screen.getByRole('alert')).toHaveTextContent(/Proposition: Proposition service unavailable/i);
                    return [2 /*return*/];
            }
        });
    }); });
});
