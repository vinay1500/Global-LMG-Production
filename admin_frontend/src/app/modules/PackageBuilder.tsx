import React, { useEffect, useState } from 'react';
import { Plus, X, Check, Save, Eye } from 'lucide-react';
import { formatCurrency } from '../data/formatters';

export interface PackageTier {
  id: string;
  name: string;
  price: number;
  points: string[];
  description?: string;
  isRecommended?: boolean;
}

interface PackageBuilderProps {
  matterId: string;
  onSave: (packages: PackageTier[]) => void;
  existingPackages?: PackageTier[];
  isSaving?: boolean;
  saveLabel?: string;
}

const DEFAULT_PACKAGES: PackageTier[] = [
  {
    id: 'tier-1',
    name: 'Basic Consultation',
    price: 15000,
    points: ['Initial Document Review', '1-Hour Strategy Session', 'Written Next-Step Summary'],
    description: 'Initial review and coordination support for the client and their independent counsel.',
    isRecommended: false,
  },
  {
    id: 'tier-2',
    name: 'Standard Support',
    price: 35000,
    points: ['Everything in Basic', 'Drafting Support', 'Counsel Coordination', 'Progress Tracking'],
    description: 'Structured matter support and lawyer-matching coordination for the selected scope.',
    isRecommended: true,
  },
  {
    id: 'tier-3',
    name: 'Comprehensive Suite',
    price: 75000,
    points: ['Everything in Standard', 'Expanded Drafting Support', 'Dedicated Case Manager', 'Priority Coordination'],
    description: 'Expanded consultancy and coordination support alongside the client-selected lawyer or expert.',
    isRecommended: false,
  },
];

export const PackageBuilder: React.FC<PackageBuilderProps> = ({
  matterId,
  onSave,
  existingPackages,
  isSaving = false,
  saveLabel = 'Save Draft',
}) => {
  const [packages, setPackages] = useState<PackageTier[]>(
    existingPackages?.length ? existingPackages : DEFAULT_PACKAGES
  );
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    if (existingPackages?.length) {
      setPackages(existingPackages);
      return;
    }

    setPackages(DEFAULT_PACKAGES);
  }, [existingPackages, matterId]);

  const addPackage = () => {
    setPackages([...packages, {
      id: `tier-${Date.now()}`,
      name: 'New Package',
      price: 0,
      points: ['New Feature']
    }]);
  };

  const removePackage = (id: string) => {
    setPackages(packages.filter(p => p.id !== id));
  };

  const updatePackage = (id: string, field: keyof PackageTier, value: any) => {
    setPackages(
      packages.map((pkg) =>
        pkg.id === id
          ? { ...pkg, [field]: value }
          : field === 'isRecommended' && value
            ? { ...pkg, isRecommended: false }
            : pkg
      )
    );
  };

  const updatePoint = (pkgId: string, pointIndex: number, value: string) => {
    setPackages(packages.map(p => {
      if (p.id === pkgId) {
        const newPoints = [...p.points];
        newPoints[pointIndex] = value;
        return { ...p, points: newPoints };
      }
      return p;
    }));
  };

  const addPoint = (pkgId: string) => {
    setPackages(packages.map(p => {
      if (p.id === pkgId) {
        return { ...p, points: [...p.points, 'New feature'] };
      }
      return p;
    }));
  };

  const removePoint = (pkgId: string, pointIndex: number) => {
    setPackages(packages.map(p => {
      if (p.id === pkgId) {
        return { ...p, points: p.points.filter((_, i) => i !== pointIndex) };
      }
      return p;
    }));
  };

  return (
    <div className="max-w-full min-w-0 space-y-6 overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-xl font-medium" style={{ fontFamily: "'Playfair Display', serif" }}>Service Proposal Studio</h3>
          <p className="text-sm text-gray-500">Design custom service tiers, preview the client experience, and publish the proposal.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!previewMode && (
            <button 
              onClick={addPackage}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium"
            >
              <Plus className="w-4 h-4" /> Add Tier
            </button>
          )}
          <button 
            onClick={() => setPreviewMode(!previewMode)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition font-medium ${previewMode ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            <Eye className="w-4 h-4" /> {previewMode ? 'Exit Preview' : 'Preview Client View'}
          </button>
          <button
            onClick={() => onSave(packages)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition font-bold disabled:opacity-60"
            disabled={isSaving}
          >
            <Save className="w-4 h-4" /> {isSaving ? 'Saving...' : saveLabel}
          </button>
        </div>
      </div>

      {previewMode ? (
        <div className="flex min-w-0 flex-col items-center rounded-xl border border-gray-200 bg-[#fafafa] p-4 sm:p-8">
          <div className="w-full max-w-4xl text-center mb-8">
            <div className="inline-flex items-center gap-2 mb-4 text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest">
              <Eye className="w-3.5 h-3.5" /> Client Portal Preview
            </div>
            <h1 className="text-3xl mb-3" style={{ fontFamily: "'Playfair Display', serif" }}>Select Your Service Package</h1>
            <p className="text-gray-600 max-w-2xl mx-auto">This is exactly how the client will see and select their package in their dashboard. Once they select a package, an invoice will automatically be generated in their ledger.</p>
          </div>

          <div className="grid w-full gap-6 admin-card-grid">
            {packages.map(pkg => (
              <div key={pkg.id} className={`relative flex min-w-0 max-w-full flex-col rounded-xl bg-white p-5 text-left admin-wrap-anywhere sm:p-6 ${pkg.isRecommended ? 'ring-2 ring-gray-900 shadow-lg' : 'border border-gray-200 shadow-sm'}`}>
                {pkg.isRecommended && (
                  <span className="absolute -top-3 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-full bg-gray-900 px-3 py-1 text-center text-[10px] font-bold uppercase tracking-widest text-white sm:whitespace-nowrap">
                    Recommended
                  </span>
                )}
                <h3 className="mb-1 text-lg font-bold text-gray-900">{pkg.name}</h3>
                <div className="mb-3 flex flex-wrap items-baseline gap-1">
                  <span className="text-2xl font-bold text-gray-900">{formatCurrency(pkg.price)}</span>
                  <span className="text-xs text-gray-500">flat fee</span>
                </div>
                <p className="text-sm text-gray-600 mb-6 flex-1">{pkg.description || 'Custom service package tailored to your needs.'}</p>
                
                <div className="space-y-3 mb-8 flex-1">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Includes</p>
                  {pkg.points.map((pt, idx) => (
                    <div key={idx} className="flex min-w-0 items-start gap-2 text-sm text-gray-700">
                      <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> <span className="min-w-0">{pt}</span>
                    </div>
                  ))}
                </div>
                
                <button className={`w-full py-2.5 rounded-lg text-sm font-bold transition ${pkg.isRecommended ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900'}`}>
                  Simulate Selection
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          {packages.map((pkg, index) => (
            <div key={pkg.id} className="group relative min-w-0 max-w-full rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              {packages.length > 1 && (
                <button 
                  onClick={() => removePackage(pkg.id)}
                  className="absolute top-4 right-4 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition opacity-0 group-hover:opacity-100"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Package Name</label>
                  <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2">
                    <input 
                      type="text" 
                      value={pkg.name}
                      onChange={(e) => updatePackage(pkg.id, 'name', e.target.value)}
                      className="min-w-0 flex-1 border-b border-gray-200 bg-transparent pb-1 text-lg font-medium outline-none transition focus:border-gray-900"
                      placeholder="e.g. Premium Suite"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer hover:text-gray-900 transition">
                      <input 
                        type="checkbox" 
                        checked={pkg.isRecommended || false} 
                        onChange={(e) => updatePackage(pkg.id, 'isRecommended', e.target.checked)}
                        className="accent-gray-900"
                      />
                      Recommend
                    </label>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Description</label>
                    <input 
                      type="text" 
                      value={pkg.description || ''}
                      onChange={(e) => updatePackage(pkg.id, 'description', e.target.value)}
                    className="w-full min-w-0 border-b border-gray-200 bg-transparent pb-1 text-sm outline-none transition focus:border-gray-900"
                    placeholder="e.g. End-to-end management..."
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">Package price (USD)</label>
                  <div className="relative">
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                    <input 
                      type="number" 
                      value={pkg.price}
                      onChange={(e) => updatePackage(pkg.id, 'price', parseInt(e.target.value) || 0)}
                      className="w-full min-w-0 border-b border-gray-200 bg-transparent pb-1 pl-5 text-2xl font-semibold outline-none transition focus:border-gray-900"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-wider text-gray-500">
                    <span>Included Features</span>
                    <button onClick={() => addPoint(pkg.id)} className="text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus className="w-3 h-3"/> Add</button>
                  </label>
                  <div className="space-y-2">
                    {pkg.points.map((point, pIndex) => (
                      <div key={pIndex} className="flex min-w-0 items-start gap-2">
                        <div className="mt-1 flex-shrink-0 w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-emerald-600" />
                        </div>
                        <input 
                          type="text" 
                          value={point}
                          onChange={(e) => updatePoint(pkg.id, pIndex, e.target.value)}
                          className="min-w-0 flex-1 border-b border-transparent bg-transparent text-sm outline-none transition hover:border-gray-200 focus:border-gray-900"
                        />
                        <button 
                          onClick={() => removePoint(pkg.id, pIndex)}
                          className="p-1 text-gray-300 hover:text-red-500 transition"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="mt-6 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                <button
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed"
                  disabled
                  title="Client preview is unavailable for this package."
                  type="button"
                >
                  Client Preview
                </button>
                {packages.length > 1 && (
                  <button 
                    onClick={() => removePackage(pkg.id)}
                    className="px-4 py-2.5 rounded-lg text-sm font-medium border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 transition"
                  >
                    Cancel Package
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
