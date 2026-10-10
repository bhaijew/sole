'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';
import { 
  Plus, 
  Pencil, 
  Trash2, 
  X, 
  User, 
  KeyRound, 
  ShieldCheck, 
  ChefHat, 
  Receipt, 
  Users, 
  CheckCircle2, 
  XCircle,
  RefreshCw,
  Cloud,
} from 'lucide-react';
import { useSystemModeStore } from '@/store/system-mode';
import type { Staff } from '@/lib/types';

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'cashier',
    pin: '',
  });

  const { isPizzaIntegrated, fetchMode } = useSystemModeStore();
  const [syncingStaff, setSyncingStaff] = useState(false);

  const fetchStaff = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/staff');
      setStaff(data.staff || []);
    } catch {
      toast.error('Failed to load staff list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
    fetchMode();
  }, [fetchMode]);

  const handleStaffSync = async () => {
    try {
      setSyncingStaff(true);
      const res = await api.post('/cloud-sync/sync-staff');
      if (res.data?.success) {
        toast.success(res.data.message || 'Staff synced from Pizza Management!');
        fetchStaff();
      } else {
        toast.error(res.data?.message || 'Staff sync failed');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || 'Staff sync failed');
    } finally {
      setSyncingStaff(false);
    }
  };

  const openAddModal = () => {
    setEditingStaff(null);
    setForm({
      name: '',
      email: '',
      password: '',
      role: 'cashier',
      pin: '',
    });
    setShowModal(true);
  };

  const openEditModal = (member: Staff) => {
    setEditingStaff(member);
    setForm({
      name: member.name,
      email: member.email || '',
      password: '',
      role: member.role || 'cashier',
      pin: member.pin || '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.name.trim()) {
      return toast.error('Name is required');
    }

    if (form.pin && !/^\d{4}$/.test(form.pin)) {
      return toast.error('PIN must be exactly 4 numeric digits (e.g. 1234)');
    }

    try {
      if (editingStaff) {
        await api.put(`/staff/${editingStaff.id}`, {
          name: form.name,
          email: form.email || null,
          password: form.password || undefined,
          role: form.role,
          pin: form.pin || null,
        });
        toast.success('Staff member updated successfully');
      } else {
        await api.post('/staff', {
          name: form.name,
          email: form.email || null,
          password: form.password || (form.pin ? String(form.pin) : '123456'),
          role: form.role,
          pin: form.pin || null,
        });
        toast.success('Staff member created successfully');
      }
      setShowModal(false);
      fetchStaff();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Operation failed');
    }
  };

  const toggleActive = async (member: Staff) => {
    const action = member.is_active ? 'deactivate' : 'reactivate';
    try {
      await api.post(`/staff/${member.id}/${action}`);
      toast.success(`Staff member ${member.is_active ? 'deactivated' : 'reactivated'}`);
      fetchStaff();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update status');
    }
  };

  const handleDelete = async (member: Staff) => {
    if (!confirm(`Are you sure you want to delete ${member.name}?`)) return;
    try {
      await api.delete(`/staff/${member.id}`);
      toast.success('Staff member deleted');
      fetchStaff();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete staff member');
    }
  };

  const roleBadges: Record<string, { label: string; color: string; icon: any }> = {
    owner:   { label: 'Owner',   color: 'bg-indigo-100 text-indigo-800 border-indigo-200', icon: ShieldCheck },
    manager: { label: 'Manager', color: 'bg-purple-100 text-purple-800 border-purple-200', icon: Users },
    cashier: { label: 'Cashier', color: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: Receipt },
    waiter:  { label: 'Waiter',  color: 'bg-blue-100 text-blue-800 border-blue-200', icon: User },
    chef:    { label: 'Chef',    color: 'bg-amber-100 text-amber-800 border-amber-200', icon: ChefHat },
  };

  const filteredStaff = staff.filter((s) => {
    if (selectedRole === 'all') return true;
    return s.role === selectedRole;
  });

  return (
    <div className="space-y-6">
      {/* Pizza System Integration Banner */}
      {isPizzaIntegrated && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-blue-100 rounded-xl text-blue-600 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-blue-950">
                Staff Managed via Pizza Management System (Cloud)
              </h3>
              <p className="text-xs text-blue-800/90 mt-0.5 max-w-2xl leading-relaxed">
                Staff accounts, POS roles (Cashier, Chef, Waiter, Manager), and 4-digit PINs are created by the Super Admin in your Pizza Management System.
                Users with POS access sync here automatically. Local addition is locked to prevent sync conflicts.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleStaffSync}
            disabled={syncingStaff}
            className="bg-blue-600 hover:bg-blue-700 text-white shrink-0 gap-1.5 shadow-xs"
          >
            <RefreshCw size={14} className={syncingStaff ? 'animate-spin' : ''} />
            {syncingStaff ? 'Syncing...' : 'Sync Staff Now'}
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User & Staff Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            {isPizzaIntegrated
              ? 'Active staff members with POS access synced from Pizza Management System.'
              : 'Manage your shop team members, assign POS roles, and set 4-digit quick login PINs.'}
          </p>
        </div>
        {!isPizzaIntegrated ? (
          <Button onClick={openAddModal} className="flex items-center gap-2">
            <Plus size={16} /> Add Staff Member
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={handleStaffSync}
            disabled={syncingStaff}
            className="flex items-center gap-2 border-blue-200 text-blue-700 hover:bg-blue-50 text-xs"
          >
            <RefreshCw size={14} className={syncingStaff ? 'animate-spin' : ''} />
            {syncingStaff ? 'Syncing...' : 'Sync Staff from Cloud'}
          </Button>
        )}
      </div>

      {/* Role Filter Tabs */}
      <div className="flex flex-wrap gap-2 border-b pb-3">
        {['all', 'owner', 'manager', 'cashier', 'waiter', 'chef'].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setSelectedRole(r)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
              selectedRole === r
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {r === 'all' ? `All Staff (${staff.length})` : r}
          </button>
        ))}
      </div>

      {/* Staff Cards Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredStaff.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-200">
          <Users size={40} className="mx-auto text-gray-400 mb-3" />
          <p className="text-gray-600 font-medium">No staff members found in this category.</p>
          <Button onClick={openAddModal} variant="outline" className="mt-4 text-xs">
            Add New Member
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStaff.map((member) => {
            const roleMeta = roleBadges[member.role] || {
              label: member.role,
              color: 'bg-gray-100 text-gray-800 border-gray-200',
              icon: User,
            };
            const RoleIcon = roleMeta.icon;

            return (
              <div
                key={member.id}
                className={`bg-white rounded-xl p-5 border transition-all ${
                  member.is_active
                    ? 'border-gray-200 shadow-sm hover:border-gray-300'
                    : 'border-gray-200 opacity-60 bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-base">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 text-base">{member.name}</h3>
                      <p className="text-xs text-gray-500">{member.email || 'No email assigned'}</p>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${roleMeta.color}`}
                  >
                    <RoleIcon size={12} />
                    {roleMeta.label}
                  </span>
                </div>

                {/* PIN and Status Info */}
                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600">
                  <div className="flex items-center gap-1.5">
                    <KeyRound size={14} className={member.pin ? 'text-amber-500' : 'text-gray-400'} />
                    <span>
                      {member.pin ? (
                        <span className="font-mono font-bold bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200">
                          PIN: {member.pin}
                        </span>
                      ) : (
                        <span className="text-gray-400 italic">No PIN set</span>
                      )}
                    </span>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 ${
                      member.is_active ? 'text-emerald-600' : 'text-red-500'
                    }`}
                  >
                    {member.is_active ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                    {member.is_active ? 'Active' : 'Deactivated'}
                  </span>
                </div>

                {/* Action Buttons */}
                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => toggleActive(member)}
                    className={`text-xs font-medium hover:underline ${
                      member.is_active ? 'text-gray-500 hover:text-red-600' : 'text-emerald-600 font-semibold'
                    }`}
                  >
                    {member.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEditModal(member)}
                      className="p-1.5 text-gray-500 hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
                      title="Edit Member"
                    >
                      <Pencil size={15} />
                    </button>
                    {member.role !== 'owner' && (
                      <button
                        type="button"
                        onClick={() => handleDelete(member)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete Member"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Staff Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 overflow-hidden">
            <div className="flex justify-between items-center mb-5 border-b pb-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {editingStaff ? 'Edit Staff Member' : 'Add New Staff Member'}
                </h2>
                <p className="text-xs text-gray-500">Configure credentials, role, and quick PIN login.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="staff-name" className="text-xs font-semibold text-gray-700">
                  Full Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="staff-name"
                  type="text"
                  placeholder="e.g. Zeeshan Ali"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1"
                  required
                />
              </div>

              <div>
                <Label htmlFor="staff-role" className="text-xs font-semibold text-gray-700">
                  POS Role <span className="text-red-500">*</span>
                </Label>
                <select
                  id="staff-role"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="cashier">Cashier (POS Billing, Orders, Receipts)</option>
                  <option value="manager">Manager (POS, Products, Tables, Staff)</option>
                  <option value="waiter">Waiter (Table order taking)</option>
                  <option value="chef">Chef (Kitchen Display Screen KDS)</option>
                  <option value="owner">Owner (Full unrestricted store access)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="staff-email" className="text-xs font-semibold text-gray-700">
                    Email (Optional)
                  </Label>
                  <Input
                    id="staff-email"
                    type="email"
                    placeholder="staff@flo.local"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="staff-pin" className="text-xs font-semibold text-gray-700">
                    4-Digit Quick PIN
                  </Label>
                  <Input
                    id="staff-pin"
                    type="password"
                    maxLength={4}
                    placeholder="e.g. 2222"
                    value={form.pin}
                    onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })}
                    className="mt-1 font-mono tracking-widest text-center"
                  />
                </div>
              </div>
              <p className="text-[11px] text-gray-400">
                Quick PIN allows cashiers and staff to sign in instantly on the POS counter with 4 digits.
              </p>

              <div>
                <Label htmlFor="staff-password" className="text-xs font-semibold text-gray-700">
                  Password {editingStaff ? '(Leave blank to keep unchanged)' : '(Optional)'}
                </Label>
                <Input
                  id="staff-password"
                  type="password"
                  placeholder={editingStaff ? '••••••••' : 'Defaults to PIN or 123456'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="mt-1"
                />
              </div>

              <div className="pt-3 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button type="submit" className="flex-1">
                  {editingStaff ? 'Save Changes' : 'Create Staff Member'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
