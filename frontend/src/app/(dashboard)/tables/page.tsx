'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';
import {
  Plus,
  RefreshCw,
  Users,
  X,
  Search,
  UtensilsCrossed,
  Clock,
  QrCode,
  CheckCircle2,
  Trash2,
  Edit3,
  Eye,
  CalendarClock,
  Sparkles,
  Phone,
  User,
  Coffee,
} from 'lucide-react';
import type { Table } from '@/lib/types';

export default function TablesPage() {
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'available' | 'occupied' | 'reserved'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [showAddEditModal, setShowAddEditModal] = useState(false);
  const [editingTable, setEditingTable] = useState<Table | null>(null);
  const [tableForm, setTableForm] = useState({
    number: '',
    name: '',
    capacity: 4,
    floor: 'Ground',
    section: '',
  });

  const [reservingTable, setReservingTable] = useState<Table | null>(null);
  const [reservationForm, setReservationForm] = useState({
    name: '',
    phone: '',
    guestCount: 2,
  });

  const [viewingOrderTable, setViewingOrderTable] = useState<Table | null>(null);
  const [orderDetails, setOrderDetails] = useState<any | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);

  // Fetch tables from backend
  const fetchTables = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const { data } = await api.get('/tables');
      setTables(data.tables || []);
    } catch {
      if (!isSilent) toast.error('Failed to load tables');
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  // Trigger Cloud Sync with Pizza Management
  const handleSyncCloud = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post('/tables/sync');
      if (data?.success) {
        toast.success(data.message || 'Tables synchronized with Pizza Management!');
      } else {
        toast.error(data?.message || 'Cloud sync error');
      }
      await fetchTables(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to sync with Pizza Management');
    } finally {
      setSyncing(false);
    }
  };

  // Real-time Event Subscription & Polling
  useEffect(() => {
    fetchTables();

    // 1. Electron IPC Realtime Event Listener
    const handleCloudEvent = (payload: any) => {
      if (
        payload?.event === 'tables-updated' ||
        payload?.event === 'order-status-updated' ||
        payload?.event === 'orders-updated' ||
        payload?.event === 'menu-updated'
      ) {
        fetchTables(true);
      }
    };

    if (typeof window !== 'undefined' && (window as any).electronAPI?.onCloudSyncEvent) {
      (window as any).electronAPI.onCloudSyncEvent(handleCloudEvent);
    }

    // 2. Window event listeners
    const handleWindowEvent = () => fetchTables(true);
    window.addEventListener('flo:tables-updated', handleWindowEvent);
    window.addEventListener('flo:order-synced', handleWindowEvent);

    // 3. Fast live polling every 2 seconds to guarantee instant deletion/creation sync
    const interval = setInterval(() => {
      fetchTables(true);
    }, 2000);

    return () => {
      clearInterval(interval);
      window.removeEventListener('flo:tables-updated', handleWindowEvent);
      window.removeEventListener('flo:order-synced', handleWindowEvent);
    };
  }, [fetchTables]);

  // Handle Add / Edit Table
  const handleOpenAddModal = () => {
    setEditingTable(null);
    setTableForm({
      number: `T${tables.length + 1}`,
      name: `Table ${tables.length + 1}`,
      capacity: 4,
      floor: 'Ground',
      section: '',
    });
    setShowAddEditModal(true);
  };

  const handleOpenEditModal = (table: Table) => {
    setEditingTable(table);
    setTableForm({
      number: table.number || table.name,
      name: table.name || '',
      capacity: table.capacity || 4,
      floor: table.floor || 'Ground',
      section: table.section || '',
    });
    setShowAddEditModal(true);
  };

  const handleSaveTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tableForm.number.trim()) {
      toast.error('Table number is required');
      return;
    }

    try {
      if (editingTable) {
        await api.put(`/tables/${editingTable.id}`, {
          ...tableForm,
          capacity: Number(tableForm.capacity),
        });
        toast.success(`Table ${tableForm.number} updated`);
      } else {
        await api.post('/tables', {
          ...tableForm,
          capacity: Number(tableForm.capacity),
        });
        toast.success(`Table ${tableForm.number} created & synced to Pizza Management!`);
      }
      setShowAddEditModal(false);
      fetchTables(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save table');
    }
  };

  // Handle Delete Table
  const handleDeleteTable = async (table: Table) => {
    if (table.status === 'occupied') {
      toast.error('Cannot delete an occupied table! Please clear the table first.');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${table.name || table.number}? This will also remove it from Pizza Management.`)) {
      return;
    }

    try {
      await api.delete(`/tables/${table.id}`);
      toast.success(`Table ${table.name || table.number} deleted`);
      fetchTables(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete table');
    }
  };

  // Handle Status Update
  const handleUpdateStatus = async (tableId: string | number, status: string) => {
    try {
      await api.patch(`/tables/${tableId}/status`, { status });
      toast.success(`Table status changed to ${status}`);
      fetchTables(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to update table status');
    }
  };

  // Handle Clear Occupied Table
  const handleClearTable = async (table: Table) => {
    if (!confirm(`Clear and mark ${table.name || table.number} as available? Active orders on this table will be completed.`)) {
      return;
    }

    try {
      await api.post(`/tables/${table.id}/clear`);
      toast.success(`Table ${table.name || table.number} is now free and available!`);
      fetchTables(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to clear table');
    }
  };

  // Handle Reserve Modal
  const handleOpenReserve = (table: Table) => {
    setReservingTable(table);
    setReservationForm({
      name: '',
      phone: '',
      guestCount: table.capacity || 2,
    });
  };

  const handleSaveReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reservingTable) return;

    try {
      await api.patch(`/tables/${reservingTable.id}/status`, {
        status: 'reserved',
        reservation_customer_name: reservationForm.name.trim() || 'Guest',
        reservation_customer_phone: reservationForm.phone.trim() || null,
      });
      toast.success(`Table ${reservingTable.name || reservingTable.number} reserved for ${reservationForm.name || 'Guest'}`);
      setReservingTable(null);
      fetchTables(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to reserve table');
    }
  };

  // View Order Details Modal
  const handleViewOrder = async (table: Table) => {
    if (!table.active_order?.id) return;
    setViewingOrderTable(table);
    setLoadingOrder(true);
    try {
      const { data } = await api.get(`/orders/${table.active_order.id}`);
      setOrderDetails(data.order || table.active_order);
    } catch {
      setOrderDetails(table.active_order);
    } finally {
      setLoadingOrder(false);
    }
  };

  // Statistics
  const stats = useMemo(() => {
    const total = tables.length;
    const available = tables.filter((t) => t.status === 'available').length;
    const occupied = tables.filter((t) => t.status === 'occupied').length;
    const reserved = tables.filter((t) => t.status === 'reserved').length;
    const totalSeats = tables.reduce((acc, t) => acc + (t.capacity || 0), 0);
    return { total, available, occupied, reserved, totalSeats };
  }, [tables]);

  // Filtered & Searched tables
  const filteredTables = useMemo(() => {
    return tables.filter((table) => {
      // Filter by status tab
      if (activeFilter !== 'all' && table.status !== activeFilter) {
        return false;
      }
      // Filter by search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const num = (table.number || '').toLowerCase();
        const name = (table.name || '').toLowerCase();
        const token = (table.token_code || '').toLowerCase();
        const orderNum = (table.active_order?.order_number || '').toLowerCase();
        return num.includes(q) || name.includes(q) || token.includes(q) || orderNum.includes(q);
      }
      return true;
    });
  }, [tables, activeFilter, searchQuery]);

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header & Real-time Live Connection Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Table Management</h1>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Pizza Management Live</span>
              <span className="text-emerald-500 font-mono text-[11px]">(Branch #4)</span>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time dine-in floor layout synced bidirectionally with central Supabase cloud.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncCloud}
            disabled={syncing}
            className="border-slate-200 hover:bg-slate-50 font-medium text-slate-700 shadow-2xs"
          >
            <RefreshCw size={14} className={`mr-1.5 text-slate-500 ${syncing ? 'animate-spin text-emerald-600' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Cloud'}
          </Button>

          <Button
            size="sm"
            onClick={handleOpenAddModal}
            className="bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm"
          >
            <Plus size={16} className="mr-1" /> Add Table
          </Button>
        </div>
      </div>

      {/* Metric Counters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Tables</span>
            <UtensilsCrossed size={16} className="text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900">{stats.total}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">{stats.totalSeats} Total Seats</div>
        </div>

        <div className="bg-emerald-50/40 p-4 rounded-xl border border-emerald-200/60 shadow-2xs">
          <div className="flex items-center justify-between text-emerald-700 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Available</span>
            <CheckCircle2 size={16} className="text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-700">{stats.available}</div>
          <div className="text-[11px] text-emerald-600/80 mt-0.5">Ready for guests</div>
        </div>

        <div className="bg-rose-50/40 p-4 rounded-xl border border-rose-200/60 shadow-2xs">
          <div className="flex items-center justify-between text-rose-700 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Occupied</span>
            <Users size={16} className="text-rose-500" />
          </div>
          <div className="text-2xl font-bold text-rose-700">{stats.occupied}</div>
          <div className="text-[11px] text-rose-600/80 mt-0.5">Dining in progress</div>
        </div>

        <div className="bg-amber-50/40 p-4 rounded-xl border border-amber-200/60 shadow-2xs">
          <div className="flex items-center justify-between text-amber-700 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Reserved</span>
            <CalendarClock size={16} className="text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-amber-700">{stats.reserved}</div>
          <div className="text-[11px] text-amber-600/80 mt-0.5">Booked slots</div>
        </div>

        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 shadow-2xs col-span-2 md:col-span-1">
          <div className="flex items-center justify-between text-slate-600 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider">Capacity</span>
            <Users size={16} className="text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-800">{stats.totalSeats}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Max restaurant capacity</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200/80">
        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          {(
            [
              { key: 'all', label: 'All Tables', count: stats.total },
              { key: 'available', label: 'Available', count: stats.available },
              { key: 'occupied', label: 'Occupied', count: stats.occupied },
              { key: 'reserved', label: 'Reserved', count: stats.reserved },
            ] as const
          ).map((filter) => (
            <button
              key={filter.key}
              onClick={() => setActiveFilter(filter.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                activeFilter === filter.key
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span>{filter.label}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeFilter === filter.key
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {filter.count}
              </span>
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search table, token, or order..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Tables Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-slate-200/80">
          <div className="w-9 h-9 border-3 border-slate-900 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm font-medium text-slate-600">Connecting to Pizza Management System...</p>
        </div>
      ) : filteredTables.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200/80 p-6">
          <UtensilsCrossed size={40} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-base font-semibold text-slate-800">No tables found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {searchQuery
              ? `No tables matching "${searchQuery}". Try clearing search filter.`
              : 'Add tables to manage dine-in guests and track real-time occupancy.'}
          </p>
          {!searchQuery && (
            <Button size="sm" onClick={handleOpenAddModal} className="mt-4 bg-slate-900 text-white">
              <Plus size={14} className="mr-1" /> Add First Table
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredTables.map((table) => {
            const isOccupied = table.status === 'occupied';
            const isReserved = table.status === 'reserved';
            const isAvailable = table.status === 'available';

            return (
              <div
                key={table.id}
                className={`relative flex flex-col justify-between bg-white rounded-2xl border transition-all duration-200 hover:shadow-md ${
                  isOccupied
                    ? 'border-rose-300 shadow-rose-100/50'
                    : isReserved
                    ? 'border-amber-300 shadow-amber-100/50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Status Bar Header */}
                <div
                  className={`h-1.5 rounded-t-2xl ${
                    isOccupied ? 'bg-rose-500' : isReserved ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                />

                <div className="p-4 space-y-3">
                  {/* Table Header: Number & Menu */}
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xl font-bold text-slate-900 tracking-tight">
                          {table.number || table.name}
                        </span>
                        {table.name && table.name !== table.number && (
                          <span className="text-xs text-slate-500 font-medium truncate max-w-[120px]">
                            {table.name}
                          </span>
                        )}
                      </div>

                      {/* Token Code (From Pizza Management Supabase) */}
                      {table.token_code && (
                        <div className="flex items-center gap-1 text-[11px] font-mono text-slate-500 mt-0.5">
                          <QrCode size={12} className="text-slate-400" />
                          <span>{table.token_code}</span>
                        </div>
                      )}
                    </div>

                    {/* Status Badge */}
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          isOccupied
                            ? 'bg-rose-100 text-rose-800'
                            : isReserved
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isOccupied
                              ? 'bg-rose-600 animate-pulse'
                              : isReserved
                              ? 'bg-amber-600'
                              : 'bg-emerald-600'
                          }`}
                        />
                        <span className="capitalize">{table.status}</span>
                      </span>

                      {/* Edit / Delete dropdown actions */}
                      <button
                        onClick={() => handleOpenEditModal(table)}
                        className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                        title="Edit Table"
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        onClick={() => handleDeleteTable(table)}
                        className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                        title="Delete Table"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Capacity & Floor Info */}
                  <div className="flex items-center gap-3 text-xs text-slate-600 font-medium">
                    <div className="flex items-center gap-1">
                      <Users size={13} className="text-slate-400" />
                      <span>{table.capacity || 4} Seats</span>
                    </div>
                    {table.floor && (
                      <span className="text-slate-400">• {table.floor}</span>
                    )}
                  </div>

                  {/* Dynamic State Info Box */}
                  {isOccupied && table.active_order && (
                    <div className="bg-rose-50/70 border border-rose-200/70 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-rose-900">
                        <span className="font-mono">#{table.active_order.order_number}</span>
                        <span className="text-rose-800 font-bold">
                          Rs {Number(table.active_order.total || 0).toLocaleString()}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-rose-700">
                        <div className="flex items-center gap-1">
                          <Clock size={11} />
                          <span>
                            {table.active_order.elapsed_minutes !== null
                              ? `${table.active_order.elapsed_minutes} min seated`
                              : 'Active'}
                          </span>
                        </div>
                        <span className="capitalize px-1.5 py-0.5 rounded bg-rose-200/60 font-semibold text-[10px]">
                          {table.active_order.status}
                        </span>
                      </div>

                      <div className="pt-1 flex gap-2">
                        <button
                          onClick={() => handleViewOrder(table)}
                          className="flex-1 py-1 text-xs bg-white text-rose-800 border border-rose-200 rounded-lg hover:bg-rose-100 font-medium flex items-center justify-center gap-1 transition"
                        >
                          <Eye size={12} /> View Order
                        </button>
                        <button
                          onClick={() => handleClearTable(table)}
                          className="flex-1 py-1 text-xs bg-rose-600 text-white rounded-lg hover:bg-rose-700 font-medium transition"
                        >
                          Clear & Free
                        </button>
                      </div>
                    </div>
                  )}

                  {isReserved && (
                    <div className="bg-amber-50 border border-amber-200/70 rounded-xl p-3 space-y-1.5 text-xs text-amber-900">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <User size={12} className="text-amber-700" />
                        <span>{table.reservation_customer_name || 'Guest Reservation'}</span>
                      </div>
                      {table.reservation_customer_phone && (
                        <div className="flex items-center gap-1.5 text-[11px] text-amber-800">
                          <Phone size={11} className="text-amber-600" />
                          <span>{table.reservation_customer_phone}</span>
                        </div>
                      )}

                      <div className="pt-2 flex gap-2">
                        <button
                          onClick={() => handleUpdateStatus(table.id, 'occupied')}
                          className="flex-1 py-1 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium transition"
                        >
                          Seat Guests
                        </button>
                        <button
                          onClick={() => handleUpdateStatus(table.id, 'available')}
                          className="py-1 px-2.5 text-xs bg-white text-amber-800 border border-amber-200 rounded-lg hover:bg-amber-100 font-medium transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {isAvailable && (
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-center">
                      <p className="text-[11px] text-slate-500 mb-2">Table is empty and ready for guests</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleUpdateStatus(table.id, 'occupied')}
                          className="flex-1 py-1 text-xs bg-slate-900 text-white rounded-lg hover:bg-slate-800 font-medium transition"
                        >
                          Seat Walk-in
                        </button>
                        <button
                          onClick={() => handleOpenReserve(table)}
                          className="flex-1 py-1 text-xs bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-100 font-medium transition"
                        >
                          Reserve
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: Add / Edit Table */}
      {showAddEditModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center mb-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {editingTable ? `Edit Table ${editingTable.number}` : 'Add New Table'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tables sync directly with Pizza Management Cloud (Shop #4)
                </p>
              </div>
              <button
                onClick={() => setShowAddEditModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveTable} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Table Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={tableForm.number}
                  onChange={(e) => setTableForm({ ...tableForm, number: e.target.value })}
                  placeholder="e.g. T1, T2, 10"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900/20 focus:border-slate-900 outline-hidden font-medium"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Table Name (Display Label)
                </label>
                <input
                  type="text"
                  value={tableForm.name}
                  onChange={(e) => setTableForm({ ...tableForm, name: e.target.value })}
                  placeholder="e.g. Table 1, Window Booth, VIP Lounge"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900/20 focus:border-slate-900 outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Capacity (Seats)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={tableForm.capacity}
                    onChange={(e) => setTableForm({ ...tableForm, capacity: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900/20 focus:border-slate-900 outline-hidden"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Floor / Zone
                  </label>
                  <select
                    value={tableForm.floor}
                    onChange={(e) => setTableForm({ ...tableForm, floor: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900/20 focus:border-slate-900 outline-hidden bg-white"
                  >
                    <option value="Ground">Ground Floor</option>
                    <option value="1st Floor">1st Floor</option>
                    <option value="Terrace">Terrace / Rooftop</option>
                    <option value="VIP Area">VIP Area</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddEditModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button type="submit" className="flex-1 bg-slate-900 hover:bg-slate-800 text-white">
                  {editingTable ? 'Update Table' : 'Create & Sync'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Reserve Table */}
      {reservingTable && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Reserve {reservingTable.name || reservingTable.number}
                </h2>
                <p className="text-xs text-slate-500">Book table for arriving guests</p>
              </div>
              <button
                onClick={() => setReservingTable(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveReservation} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Customer Name
                </label>
                <input
                  type="text"
                  value={reservationForm.name}
                  onChange={(e) => setReservationForm({ ...reservationForm, name: e.target.value })}
                  placeholder="e.g. Ali Ahmed"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900/20 focus:border-slate-900 outline-hidden"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Phone Number
                </label>
                <input
                  type="text"
                  value={reservationForm.phone}
                  onChange={(e) => setReservationForm({ ...reservationForm, phone: e.target.value })}
                  placeholder="e.g. 03001234567"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900/20 focus:border-slate-900 outline-hidden"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReservingTable(null)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button type="submit" className="flex-1 bg-amber-600 hover:bg-amber-700 text-white">
                  Confirm Reservation
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: View Active Order Details */}
      {viewingOrderTable && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {viewingOrderTable.name || viewingOrderTable.number} Active Order
                </h2>
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                  <span className="font-mono font-semibold">#{orderDetails?.order_number}</span>
                  <span>•</span>
                  <span className="capitalize px-1.5 py-0.2 rounded bg-slate-100 font-medium">
                    {orderDetails?.status}
                  </span>
                </div>
              </div>
              <button
                onClick={() => {
                  setViewingOrderTable(null);
                  setOrderDetails(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            {loadingOrder ? (
              <div className="py-12 text-center">
                <div className="w-7 h-7 border-3 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-xs text-slate-500">Loading order items...</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Order Items List */}
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                  {orderDetails?.items && Array.isArray(orderDetails.items) && orderDetails.items.length > 0 ? (
                    orderDetails.items.map((item: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-slate-800">
                            {item.quantity || item.qty || 1}x {item.product_name || item.name}
                          </div>
                          {item.notes && (
                            <div className="text-[11px] text-slate-400 italic">{item.notes}</div>
                          )}
                        </div>
                        <div className="font-bold text-slate-900">
                          Rs {Number((item.price || 0) * (item.quantity || item.qty || 1)).toLocaleString()}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400 text-center py-4">No detailed items recorded</p>
                  )}
                </div>

                {/* Total Summary */}
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Order Source:</span>
                    <span className="font-medium uppercase">{orderDetails?.order_source || 'POS Dine-in'}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Placed At:</span>
                    <span className="font-medium">
                      {orderDetails?.created_at ? new Date(orderDetails.created_at).toLocaleTimeString() : 'N/A'}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex justify-between text-sm font-bold text-slate-900">
                    <span>Total Bill:</span>
                    <span className="text-base text-rose-700">
                      Rs {Number(orderDetails?.total || viewingOrderTable.active_order?.total || 0).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-2 flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setViewingOrderTable(null);
                      setOrderDetails(null);
                    }}
                    className="flex-1"
                  >
                    Close
                  </Button>
                  <Button
                    onClick={async () => {
                      await handleClearTable(viewingOrderTable);
                      setViewingOrderTable(null);
                      setOrderDetails(null);
                    }}
                    className="flex-1 bg-rose-600 hover:bg-rose-700 text-white"
                  >
                    Complete & Free Table
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
