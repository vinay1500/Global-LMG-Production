import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/httpErrors.js';
import { runIdempotentJson } from '../lib/idempotency.js';
import {
  addMatterNote,
  createMatter,
  createMatterAssignment,
  getMatterWorkspace,
  listMatters,
  replaceMatterAssignments,
  updateMatterDetails,
  updateMatterStage,
} from '../modules/matters/service.js';
import {
  archiveProposal,
  getMatterPackageProposals,
  overridePackageSelection,
  publishProposal,
  saveDraftProposal,
} from '../modules/packages/service.js';
import { requireMutationPermission, requireReadPermission } from './shared.js';

export const mattersRouter = Router();

const updateStageSchema = z.object({
  changeNote: z.string().trim().max(2000).optional(),
  operationalStatusCode: z.string().trim().min(2).max(64).optional(),
  stageCode: z.string().trim().min(2).max(64),
  visibleToClient: z.boolean().optional(),
});

const createMatterNoteSchema = z.object({
  bodyText: z.string().trim().min(2).max(4000),
  title: z.string().trim().min(2).max(200),
  visibleToClient: z.boolean().optional(),
});

const FEE_TOLERANCE = 0.01;

export const assignmentSchema = z
  .object({
    assignmentRoleCode: z.string().trim().min(2).max(64),
    counselPartnerId: z.string().trim().min(2).max(64).optional(),
    feeAgreedAmount: z.number().nonnegative().optional(),
    feeDueAmount: z.number().nonnegative().optional(),
    feePaidAmount: z.number().nonnegative().optional(),
    internalUserId: z.string().trim().min(2).max(64).optional(),
    isPrimary: z.boolean().optional(),
    notes: z.string().trim().max(2000).optional(),
    visibleToClient: z.boolean().optional(),
  })
  .superRefine((payload, context) => {
    const agreed = payload.feeAgreedAmount;

    if (typeof agreed !== 'number') {
      return;
    }

    if (
      typeof payload.feePaidAmount === 'number' &&
      payload.feePaidAmount > agreed + FEE_TOLERANCE
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Paid amount cannot exceed agreed amount.',
        path: ['feePaidAmount'],
      });
    }

    if (
      typeof payload.feeDueAmount === 'number' &&
      payload.feeDueAmount > agreed + FEE_TOLERANCE
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Due amount cannot exceed agreed amount.',
        path: ['feeDueAmount'],
      });
    }

    const paid = payload.feePaidAmount ?? 0;
    const due = payload.feeDueAmount ?? 0;

    if (paid + due > agreed + FEE_TOLERANCE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Paid plus due cannot exceed agreed amount.',
        path: ['feeDueAmount'],
      });
    }
  });

const assignmentEntrySchema = z.object({
  id: z.string().trim().min(2).max(64),
  visibleToClient: z.boolean().optional(),
});

const replaceAssignmentsSchema = z.object({
  externalCounsel: z.array(assignmentEntrySchema).max(20).optional(),
  fieldPartners: z.array(assignmentEntrySchema).max(20).optional(),
  staff: z.array(assignmentEntrySchema).max(20).optional(),
});

const updateMatterDetailsSchema = z.object({
  issueSummary: z.string().trim().min(2).max(4000).optional(),
  operationalStatusCode: z.string().trim().min(2).max(64).optional(),
  priorityCode: z.string().trim().min(2).max(64).optional(),
  quotedTotalAmount: z.number().nonnegative().optional(),
  selectedServices: z.array(z.string().trim().min(2).max(64)).max(20).optional(),
});

const createMatterSchema = z.object({
  clientAccountPublicId: z.string().trim().min(2).max(64),
  clientVisible: z.boolean().optional(),
  consultationModeCode: z.string().trim().min(2).max(64).optional(),
  legalDomainCode: z.string().trim().min(2).max(64).optional(),
  priorityCode: z.string().trim().min(2).max(64).optional(),
  serviceCode: z.string().trim().min(2).max(64).optional(),
  serviceCodes: z.array(z.string().trim().min(2).max(64)).max(20).optional(),
  stageCode: z.string().trim().min(2).max(64).optional(),
  statusCode: z.string().trim().min(2).max(64).optional(),
  summary: z.string().trim().max(4000).optional(),
  title: z.string().trim().min(2).max(255),
  urgencyCode: z.string().trim().min(2).max(64).optional(),
});

const packageDraftSchema = z.object({
  proposalVersion: z.number().int().positive().optional(),
  packages: z
    .array(
      z.object({
        description: z.string().trim().max(2000).optional(),
        displayOrder: z.number().int().min(0).optional(),
        featurePoints: z.array(z.string().trim().min(1).max(255)).max(25).optional(),
        id: z.string().trim().min(2).max(64).optional(),
        isRecommended: z.boolean().optional(),
        name: z.string().trim().min(2).max(160),
        price: z.number().nonnegative(),
        serviceCodes: z.array(z.string().trim().min(2).max(64)).max(20).optional(),
      })
    )
    .min(1)
    .max(8),
});

const packagePublishSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  proposalVersion: z.number().int().positive(),
});

const packageOverrideSchema = z.object({
  matterPackageId: z.string().trim().min(2).max(64),
  reasonText: z.string().trim().min(5).max(2000),
});

mattersRouter.get(
  '/matters',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'matter.view');
    response.json(
      await listMatters({
        limit: Number(request.query.limit || 50),
        offset: Number(request.query.offset || 0),
        search: typeof request.query.search === 'string' ? request.query.search : undefined,
      })
    );
  })
);

mattersRouter.post(
  '/matters',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'matter.update');
    const payload = createMatterSchema.parse(request.body);
    const result = await runIdempotentJson(request, {
      actorKey: actor.id,
      actorUserId: actor.userId,
      operation: () => createMatter(actor, payload),
      scope: 'admin:matter:create',
      statusCode: 201,
    });
    response.setHeader('Idempotency-Replayed', result.replayed ? 'true' : 'false');
    response.status(result.statusCode).json(result.body);
  })
);

mattersRouter.get(
  '/matters/:matterId',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'matter.view');
    response.json(await getMatterWorkspace(String(request.params.matterId || '')));
  })
);

mattersRouter.get(
  '/matters/:matterId/package-proposals',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'matter.view');
    response.json(await getMatterPackageProposals(String(request.params.matterId || '')));
  })
);

mattersRouter.patch(
  '/matters/:matterId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'matter.update');
    response.json(
      await updateMatterDetails(
        actor,
        String(request.params.matterId || ''),
        updateMatterDetailsSchema.parse(request.body)
      )
    );
  })
);

mattersRouter.patch(
  '/matters/:matterId/stage',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'matter.update');
    response.json(
      await updateMatterStage(
        actor,
        String(request.params.matterId || ''),
        updateStageSchema.parse(request.body)
      )
    );
  })
);

mattersRouter.put(
  '/matters/:matterId/package-proposals/draft',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'matter.update');
    response.json(
      await saveDraftProposal(
        actor,
        String(request.params.matterId || ''),
        packageDraftSchema.parse(request.body)
      )
    );
  })
);

mattersRouter.post(
  '/matters/:matterId/package-proposals/publish',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'matter.update');
    response.json(
      await publishProposal(
        actor,
        String(request.params.matterId || ''),
        packagePublishSchema.parse(request.body)
      )
    );
  })
);

mattersRouter.post(
  '/matters/:matterId/package-selection/override',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'matter.update');
    response.json(
      await overridePackageSelection(
        actor,
        String(request.params.matterId || ''),
        packageOverrideSchema.parse(request.body)
      )
    );
  })
);

mattersRouter.post(
  '/matters/:matterId/notes',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'matter.update');
    response.status(201).json(
      await addMatterNote(
        actor,
        String(request.params.matterId || ''),
        createMatterNoteSchema.parse(request.body)
      )
    );
  })
);

mattersRouter.post(
  '/matters/:matterId/assignments',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'matter.update');
    response.status(201).json(
      await createMatterAssignment(
        actor,
        String(request.params.matterId || ''),
        assignmentSchema.parse(request.body)
      )
    );
  })
);

mattersRouter.put(
  '/matters/:matterId/assignments',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'matter.update');
    response.json(
      await replaceMatterAssignments(
        actor,
        String(request.params.matterId || ''),
        replaceAssignmentsSchema.parse(request.body)
      )
    );
  })
);

mattersRouter.post(
  '/matters/:matterId/package-proposals/:proposalVersion/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'matter.update');
    response.json(
      await archiveProposal(
        actor,
        String(request.params.matterId || ''),
        z.coerce.number().int().positive().parse(request.params.proposalVersion)
      )
    );
  })
);
