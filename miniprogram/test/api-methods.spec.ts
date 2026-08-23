import { fetchPetDetail, fetchPets } from '../api/pets';
import { addFavorite, fetchVenueDetail, fetchVenues, removeFavorite } from '../api/venues';
import { ApiClient } from '../api/request';
import { SessionStore, TOKEN_STORAGE_KEY } from '../store/session';
import { FakeWx, ok } from './fake-wx';

const BASE = 'https://api.example.com';

describe('浏览闭环 api 包装', () => {
  let wx: FakeWx;
  let client: ApiClient;

  beforeEach(() => {
    wx = new FakeWx();
    wx.setStorage(TOKEN_STORAGE_KEY, 't');
    client = new ApiClient(wx, new SessionStore(wx, BASE), BASE);
  });

  it('fetchPets 发 GET /pets，data 带筛选条件', async () => {
    wx.queue(() => ok({ items: [], hasMore: false, page: 1 }));
    await fetchPets({ species: 'cat', breed: 'all', page: 1, pageSize: 10 }, client);
    expect(wx.sent[0].method).toBe('GET');
    expect(wx.sent[0].url).toBe(`${BASE}/pets`);
    expect(wx.sent[0].data).toMatchObject({ species: 'cat', breed: 'all', page: 1, pageSize: 10 });
  });

  it('fetchPetDetail 拼 id 进 url，坐标进 data', async () => {
    wx.queue(() => ok({ id: 'p-1', photos: [] }));
    await fetchPetDetail('p-1', client, 39.9, 116.4);
    expect(wx.sent[0].url).toBe(`${BASE}/pets/p-1`);
    expect(wx.sent[0].data).toMatchObject({ lat: 39.9, lng: 116.4 });
  });

  it('fetchPets 解包出 PetListResponse 形状', async () => {
    const items = [{ id: 'p-1', name: '大黄' }];
    wx.queue(() => ok({ items, hasMore: false, page: 1 }));
    const res = await fetchPets({ species: 'all', breed: 'all', page: 1, pageSize: 10 }, client);
    expect(res.items.length).toBe(1);
    expect(res.hasMore).toBe(false);
    expect(res.page).toBe(1);
  });

  it('fetchVenues 发 GET /venues', async () => {
    wx.queue(() => ok([]));
    await fetchVenues({ category: 'park', lat: 39.9, lng: 116.4 }, client);
    expect(wx.sent[0].method).toBe('GET');
    expect(wx.sent[0].url).toBe(`${BASE}/venues`);
    expect(wx.sent[0].data).toMatchObject({ category: 'park' });
  });

  it('fetchVenueDetail 拼 poiId 进 url', async () => {
    wx.queue(() => ok({ poiId: 'v-1' }));
    await fetchVenueDetail('v-1', client);
    expect(wx.sent[0].url).toBe(`${BASE}/venues/v-1`);
  });

  it('addFavorite 发 POST，removeFavorite 发 DELETE', async () => {
    wx.queue(() => ok({ isFavorite: true }));
    await addFavorite('v-1', client);
    expect(wx.sent[0].method).toBe('POST');
    expect(wx.sent[0].url).toBe(`${BASE}/venues/v-1/favorite`);

    wx.queue(() => ok({ isFavorite: true }), () => ok({ isFavorite: false }));
    await removeFavorite('v-1', client);
    expect(wx.sent[1].method).toBe('DELETE');
    expect(wx.sent[1].url).toBe(`${BASE}/venues/v-1/favorite`);
  });
});
